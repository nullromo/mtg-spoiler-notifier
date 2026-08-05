#!/usr/bin/env bash
# Regression tests for the ways this notifier can misreport what it sent:
# issue #8 (a card is notified twice), issue #10 (a card is recorded as
# notified when nothing went out) and issue #11 (a card is recorded as
# notified when it went out to some destinations but not others).
#
# The rules the ledger applies are unit-tested directly in test/ledger.test.ts.
# What this suite covers is the part no unit test can reach: the interaction
# between a mid-run crash, the process exit code, and the GitHub Actions
# artifact hand-off, which is where all three bugs actually lived. So the seam
# used here is the process boundary — run the whole notifier against fake
# services (test/mock-services.js) and assert on which notifications actually
# went out versus which ones the results file claims went out.
#
# Each scenario() chains N runs and reproduces the artifact hand-off from
# .github/workflows/main-runner.yml: results.json becomes the next run's
# previous-results.json only when that workflow would have uploaded it.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$REPO/.github/workflows/main-runner.yml"
failures=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() {
    printf '  \033[31mFAIL\033[0m %s\n' "$1"
    failures=$((failures + 1))
}

# ---------------------------------------------------------------------------
# make_sandbox <catalog-json> <previous-results> <recipients-json>
#
# Builds a throwaway working directory holding everything the notifier reads,
# and echoes its path. <previous-results> is the contents for
# previous-results.json, or the word ABSENT to leave the file off disk — which
# is what a failed artifact download looks like.
# ---------------------------------------------------------------------------
make_sandbox() {
    local catalog="$1" previous="$2" recipients="$3"
    local sandbox
    sandbox="$(mktemp -d)"
    mkdir -p "$sandbox/images"
    echo "$recipients" >"$sandbox/recipients.json"
    echo "$catalog" >"$sandbox/catalog.json"
    if [ "$previous" != ABSENT ]; then
        echo "$previous" >"$sandbox/previous-results.json"
    fi
    echo "$sandbox"
}

# ---------------------------------------------------------------------------
# run_notifier <sandbox> <notify-log> <broken-json> <email-fails-on> <log-name>
#
# Runs the notifier once with <sandbox> as its working directory, against the
# fake services. Returns the notifier's exit code; its output is left in
# <sandbox>/<log-name>.
# ---------------------------------------------------------------------------
run_notifier() {
    local sandbox="$1" notify_log="$2" broken="$3" email_fails_on="$4"
    local log_name="$5"
    (
        cd "$sandbox" || exit 99
        NOTIFY_LOG="$notify_log" \
            HARNESS_CATALOG="$sandbox/catalog.json" \
            HARNESS_BROKEN="$broken" \
            HARNESS_EMAIL_FAILS_ON="$email_fails_on" \
            HARNESS_EMAIL_FAILS_FOR="${HARNESS_EMAIL_FAILS_FOR:-}" \
            HARNESS_DISCORD_FAILS_ON="${HARNESS_DISCORD_FAILS_ON:-}" \
            HARNESS_ATTACHMENT_LOG="${HARNESS_ATTACHMENT_LOG:-}" \
            SECRET_GMAIL_APP_PASSWORD=test \
            SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK=https://discord.invalid/a \
            SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK=https://discord.invalid/b \
            TS_NODE_PROJECT="$REPO/tsconfig.json" \
            npx --yes ts-node -r "$REPO/test/mock-services.js" \
            "$REPO/src/main.ts" \
            >"$sandbox/$log_name" 2>&1
    )
}

# the cards a notify log says really went out by e-mail, one name per line
notified_names() {
    awk -F'|' '$1 ~ /^email:/ { print $2 }' "$1" 2>/dev/null |
        grep -oE 'New Card: \[\[[^]]*\]\]' |
        sed -E 's/New Card: \[\[(.*)\]\]/\1/'
}

# the cards one specific destination really received, one name per line
delivered_to() {
    awk -F'|' -v destination="$2" '$1 == destination { print $2 }' "$1" \
        2>/dev/null |
        grep -oE 'New Card: \[\[[^]]*\]\]' |
        sed -E 's/New Card: \[\[(.*)\]\]/\1/'
}

# the card names a results.json / previous-results.json says have been seen,
# one per line. Both the ledger object and the legacy flat array are read, since
# the legacy shape is what an in-flight artifact still holds. A file that is
# absent or unreadable contributes no names, which is exactly how the notifier
# should be judged: it recorded nothing
recorded_names() {
    node -e '
        const fs = require("fs");
        try {
            const parsed = JSON.parse(fs.readFileSync(process.argv[1]).toString());
            const names = Array.isArray(parsed) ? parsed : parsed.known;
            if (Array.isArray(names)) {
                names.forEach((name) => process.stdout.write(`${name}\n`));
            }
        } catch (error) {
            // absent or unreadable
        }
    ' "$1"
}

# the cards a results.json still says a destination is owed, one per line
outstanding_for() {
    node -e '
        const fs = require("fs");
        try {
            const ledger = JSON.parse(fs.readFileSync(process.argv[1]).toString());
            const owed = (ledger.outstanding || {})[process.argv[2]] || [];
            owed.forEach((name) => process.stdout.write(`${name}\n`));
        } catch (error) {
            // absent or unreadable
        }
    ' "$1" "$2"
}

# ---------------------------------------------------------------------------
# The workflow must upload results even when the run fails. Without this, a
# crash silently discards the results file that main.ts correctly wrote, and
# every card already notified in that run gets notified again next time.
# ---------------------------------------------------------------------------
check_workflow_uploads_on_failure() {
    echo "workflow: results are uploaded even when the run fails"
    local block
    block="$(awk '
        /^      - name: Upload results/ { inblock = 1; next }
        inblock && /^      - / { inblock = 0 }
        inblock { print }
    ' "$WORKFLOW")"

    if [ -z "$block" ]; then
        fail "no 'Upload results' step found in main-runner.yml"
        return
    fi
    if echo "$block" | grep -qE '^[[:space:]]*if:[[:space:]]*always\(\)'; then
        pass "'Upload results' runs with if: always()"
    else
        fail "'Upload results' has no 'if: always()' — a failed run will discard results.json"
    fi
}

# ---------------------------------------------------------------------------
# scenario <name> <catalog-json> <broken-json> <email-fails-on> <runs> \
#          <upload-mode> <expected-notifications>
#
# expected-notifications is the exact set of card names that should be
# notified across ALL runs, one per line. Asserting the exact set catches both
# duplicates (a name appearing twice) and lost cards (a name never appearing).
# ---------------------------------------------------------------------------
scenario() {
    local name="$1" catalog="$2" broken="$3" email_fails_on="$4"
    local runs="$5" upload_mode="$6" expected="$7"

    echo "$name"

    local sandbox
    sandbox="$(make_sandbox "$catalog" '[]' '["harness***AT***example.com"]')"
    : >"$sandbox/all-notified.txt"

    local n rc
    for n in $(seq 1 "$runs"); do
        : >"$sandbox/notified-run$n.txt"
        run_notifier "$sandbox" "$sandbox/notified-run$n.txt" \
            "$broken" "$email_fails_on" "run$n.log"
        rc=$?

        notified_names "$sandbox/notified-run$n.txt" >>"$sandbox/all-notified.txt"

        # the workflow's artifact hand-off
        if [ "$upload_mode" = always ] || [ "$rc" -eq 0 ]; then
            [ -f "$sandbox/results.json" ] &&
                mv "$sandbox/results.json" "$sandbox/previous-results.json"
        fi
        # otherwise nothing is uploaded, so the next run re-downloads the older
        # artifact and previous-results.json is left exactly as it was
    done

    local diff_output
    diff_output="$(diff <(echo "$expected" | sort) \
        <(sort "$sandbox/all-notified.txt") 2>&1)"

    if [ -z "$diff_output" ]; then
        pass "notifications sent exactly once each"
        rm -rf "$sandbox"
    else
        fail "wrong notifications (< expected, > actual):"
        echo "$diff_output" | sed 's/^/        /'
        echo "        logs kept in $sandbox"
    fi
}

# ---------------------------------------------------------------------------
# sends_and_records_nothing <name> <catalog-json> <previous-results> <recipients>
#
#   <previous-results>  contents for previous-results.json, or the word ABSENT
#                       to leave the file off disk entirely
#   <recipients>        contents for recipients.json
#
# A name in results.json means a notification really went out. Nothing ever
# reconsiders a name once it lands there, so recording a card that was not sent
# is a permanent, invisible loss — strictly worse than a duplicate. See #10.
#
# Both scenarios below describe a run that cannot legitimately send anything,
# so the correct behaviour is to send nothing, record nothing, and complain.
# ---------------------------------------------------------------------------
sends_and_records_nothing() {
    local name="$1" catalog="$2" previous="$3" recipients="$4"

    echo "$name"

    local sandbox
    sandbox="$(make_sandbox "$catalog" "$previous" "$recipients")"
    : >"$sandbox/notified.txt"

    local rc
    run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' run.log
    rc=$?

    local sent_count
    sent_count="$(notified_names "$sandbox/notified.txt" | wc -l)"

    local kept=false

    # A run that cannot trust its ledger must not write one at all, so that CI
    # uploads no artifact and the last known-good one survives for the next run
    # to pick up. Writing anything here — even something that looks harmless —
    # is how the old code marked the whole catalog as reported
    if [ ! -f "$sandbox/results.json" ]; then
        pass "records nothing at all"
    else
        fail "wrote a results file, so the last known-good ledger is replaced:"
        recorded_names "$sandbox/results.json" | head -3 | sed 's/^/        /'
        kept=true
    fi

    if [ "$sent_count" -eq 0 ]; then
        pass "sends nothing"
    else
        fail "sent $sent_count notification(s), expected none"
        kept=true
    fi

    if [ "$rc" -ne 0 ]; then
        pass "exits non-zero so the failure is visible"
    else
        fail "exited 0 — the failure is silently absorbed"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# ---------------------------------------------------------------------------
# bootstrap_adopts_catalog <name> <catalog-json> <catalog-size>
#
# The one sanctioned exception to "recorded means sent". A previous-results.json
# that is present and deliberately empty says "this is a first run, adopt
# whatever Scryfall has now as the baseline" — nobody wants tens of thousands of
# e-mails. It is also the only way back once the artifact is gone for good,
# which is what the workflow's `bootstrap` input writes, so it has to keep
# working: every other path in here refuses to record what it did not send.
# ---------------------------------------------------------------------------
bootstrap_adopts_catalog() {
    local name="$1" catalog="$2" catalog_size="$3"

    echo "$name"

    local sandbox
    sandbox="$(make_sandbox "$catalog" '[]' '["harness***AT***example.com"]')"
    : >"$sandbox/notified.txt"

    local rc
    run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' run.log
    rc=$?

    local sent_count recorded_count
    sent_count="$(notified_names "$sandbox/notified.txt" | wc -l)"
    recorded_count="$(recorded_names "$sandbox/results.json" | wc -l)"

    local kept=false

    if [ "$rc" -eq 0 ] && [ "$sent_count" -eq 0 ] &&
        [ "$recorded_count" -eq "$catalog_size" ]; then
        pass "adopts the catalog as the baseline and sends nothing"
    else
        fail "expected exit 0, 0 sent and $catalog_size recorded; got exit $rc, $sent_count sent, $recorded_count recorded"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# ---------------------------------------------------------------------------
# expect_delivered <notify-log> <destination> <expected-names> <label>
#
# Asserts the exact set of cards one destination received. Exact, so it catches
# both a card that never arrived and a card that arrived twice.
# ---------------------------------------------------------------------------
expect_delivered() {
    local log="$1" destination="$2" expected="$3" label="$4"
    local diff_output
    diff_output="$(diff <(printf '%s\n' "$expected" | sed '/^$/d' | sort) \
        <(delivered_to "$log" "$destination" | sort) 2>&1)"
    if [ -z "$diff_output" ]; then
        pass "$label"
        return 0
    fi
    fail "$label (< expected, > actual):"
    echo "$diff_output" | sed 's/^/        /'
    return 1
}

# ---------------------------------------------------------------------------
# Issue #11, the headline case. One global sent list could not express
# "delivered to A but not B", and the Discord posts were fire-and-forget, so a
# webhook returning 500 was logged and forgotten while the card was recorded as
# reported. Discord subscribers never saw it and it was never retried.
#
# The card must reach the destinations that are up, exactly once each, and stay
# owed to the one that is down.
# ---------------------------------------------------------------------------
discord_failure_is_not_a_loss() {
    echo "discord failure: the card is not lost, and the e-mail is not repeated"

    local sandbox
    sandbox="$(make_sandbox '["Card One"]' '[]' '["harness***AT***example.com"]')"
    : >"$sandbox/notified.txt"

    local n kept=false
    for n in 1 2; do
        HARNESS_DISCORD_FAILS_ON='discord.invalid/a' \
            run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' "run$n.log"
        [ -f "$sandbox/results.json" ] &&
            cp "$sandbox/results.json" "$sandbox/previous-results.json"
    done

    expect_delivered "$sandbox/notified.txt" 'email:harness@example.com' \
        'Card One' "e-mail received it once, not once per run" || kept=true
    expect_delivered "$sandbox/notified.txt" \
        'discord:https://discord.invalid/b' \
        'Card One' "the healthy webhook received it once" || kept=true
    expect_delivered "$sandbox/notified.txt" \
        'discord:https://discord.invalid/a' \
        '' "the broken webhook received nothing" || kept=true

    local still_owed
    still_owed="$(outstanding_for "$sandbox/results.json" \
        'discord:quoyles-quarters')"
    if [ "$still_owed" = "Card One" ]; then
        pass "the broken webhook is still owed it, so it will be retried"
    else
        fail "expected the broken webhook to still be owed 'Card One', got: $still_owed"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# ---------------------------------------------------------------------------
# Issue #11's other half. EMailer.broadcast wrapped the recipients in a
# Promise.all, so one failing recipient rejected the whole broadcast and nobody
# was recorded — which meant every recipient who HAD received the card got it
# again on the next run.
# ---------------------------------------------------------------------------
partial_email_failure_does_not_duplicate() {
    echo "partial e-mail failure: the recipient who got it does not get it again"

    local sandbox
    sandbox="$(make_sandbox '["Card One"]' '[]' \
        '["a***AT***example.com", "b***AT***example.com"]')"
    : >"$sandbox/notified.txt"

    local n kept=false
    for n in 1 2; do
        HARNESS_EMAIL_FAILS_FOR='b@example.com' \
            run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' "run$n.log"
        [ -f "$sandbox/results.json" ] &&
            cp "$sandbox/results.json" "$sandbox/previous-results.json"
    done

    expect_delivered "$sandbox/notified.txt" 'email:a@example.com' \
        'Card One' "the working recipient received it exactly once" || kept=true
    expect_delivered "$sandbox/notified.txt" 'email:b@example.com' \
        '' "the failing recipient received nothing" || kept=true

    local still_owed
    still_owed="$(outstanding_for "$sandbox/results.json" \
        'email:b***AT***example.com')"
    if [ "$still_owed" = "Card One" ]; then
        pass "the failing recipient is still owed it, so it will be retried"
    else
        fail "expected the failing recipient to still be owed 'Card One', got: $still_owed"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# ---------------------------------------------------------------------------
# The in-flight artifact is a flat string[], and every name in it was reported
# to everybody. It must migrate to a ledger where nobody is owed anything —
# because the alternative, treating each destination as newly discovered and
# therefore owed the lot, would mail out the entire 28,000-card back catalogue.
#
# This also pins the no-backfill rule for destinations generally: every
# destination is brand new against a migrated ledger.
# ---------------------------------------------------------------------------
legacy_ledger_migrates_without_backfill() {
    echo "legacy results file: migrates without owing anybody the back catalogue"

    local sandbox
    sandbox="$(make_sandbox '["Card One", "Card Two"]' \
        '["Card One", "Card Two"]' '["harness***AT***example.com"]')"
    : >"$sandbox/notified.txt"

    local rc kept=false
    run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' run.log
    rc=$?

    local sent_count recorded_count owed
    sent_count="$(notified_names "$sandbox/notified.txt" | wc -l)"
    recorded_count="$(recorded_names "$sandbox/results.json" | wc -l)"
    owed="$(outstanding_for "$sandbox/results.json" \
        'email:harness***AT***example.com')"

    if [ "$rc" -eq 0 ] && [ "$sent_count" -eq 0 ] && [ -z "$owed" ]; then
        pass "sends nothing and owes nothing"
    else
        fail "expected exit 0, 0 sent and nothing owed; got exit $rc, $sent_count sent, owed: $owed"
        kept=true
    fi

    if [ "$recorded_count" -eq 2 ]; then
        pass "keeps the migrated card names"
    else
        fail "expected 2 known cards after migration, got $recorded_count"
        kept=true
    fi

    # The ledger is uploaded as a GitHub Actions artifact, and artifacts on
    # public repos are publicly downloadable. recipients.json obfuscates
    # addresses specifically to keep them away from scrapers, so keying the
    # ledger by the real address would undo that
    if grep -q '\*\*\*AT\*\*\*' "$sandbox/results.json" &&
        ! grep -q '@' "$sandbox/results.json"; then
        pass "keys destinations by the obfuscated address, not the real one"
    else
        fail "the results file contains a raw e-mail address"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# ---------------------------------------------------------------------------
# A double-faced card is the one shape where a card is not a single block of
# text with a single picture, and nothing but a whole run drives that wiring:
# one image file per face, one attachment per face, and a distinct content ID
# for each so the HTML can reference them. The rendering itself is covered
# directly in test/presentation.test.ts; what is proved here is that a card
# with two faces still reaches every destination exactly once.
# ---------------------------------------------------------------------------
two_faced_card_is_delivered_whole() {
    echo "double-faced card: one attachment per face, delivered once each"

    local sandbox
    sandbox="$(make_sandbox '["Two Faced Test"]' '[]' \
        '["harness***AT***example.com"]')"
    : >"$sandbox/notified.txt"
    : >"$sandbox/attachments.txt"

    local rc kept=false
    HARNESS_ATTACHMENT_LOG="$sandbox/attachments.txt" \
        run_notifier "$sandbox" "$sandbox/notified.txt" '[]' '' run.log
    rc=$?

    expect_delivered "$sandbox/notified.txt" 'email:harness@example.com' \
        'Two Faced Test' "e-mail received it once" || kept=true
    expect_delivered "$sandbox/notified.txt" \
        'discord:https://discord.invalid/a' \
        'Two Faced Test' "the first webhook received it once" || kept=true
    expect_delivered "$sandbox/notified.txt" \
        'discord:https://discord.invalid/b' \
        'Two Faced Test' "the second webhook received it once" || kept=true

    # two faces, two images, two attachments, two different content IDs
    local cids distinct
    cids="$(awk -F'|' 'NR == 1 { print $2 }' "$sandbox/attachments.txt")"
    distinct="$(echo "$cids" | tr ',' '\n' | sed '/^$/d' | sort -u | wc -l)"
    if [ "$distinct" -eq 2 ]; then
        pass "carries a distinct attachment for each face"
    else
        fail "expected 2 distinct attachment CIDs, got $distinct: $cids"
        kept=true
    fi

    # the run cleans up after itself however many images a card had
    if [ -z "$(ls -A "$sandbox/images" 2>/dev/null)" ]; then
        pass "removes both face images afterwards"
    else
        fail "left image files behind: $(ls -A "$sandbox/images")"
        kept=true
    fi

    if [ "$rc" -ne 0 ]; then
        fail "expected exit 0, got $rc"
        kept=true
    fi

    if [ "$kept" = true ]; then
        echo "        logs kept in $sandbox"
    else
        rm -rf "$sandbox"
    fi
}

# a catalog too big to be a real batch of new cards, which is what the notifier
# sees whenever it has no remembered list to compare against
big_catalog() {
    node -e '
        const names = [];
        for (let index = 0; index < 10500; index += 1) {
            names.push(`Catalog Card ${index}`);
        }
        process.stdout.write(JSON.stringify(names));
    '
}

echo
check_workflow_uploads_on_failure

echo
# The original bug. A catalog name with no card behind it used to abort the
# whole run, so the results file was never uploaded and everything already
# sent went out again on the next run — forever, every 30 minutes.
scenario \
    "unfetchable card: does not duplicate, and does not block the queue" \
    '["New Card One", "Broken Card", "New Card Two"]' \
    '["Broken Card"]' \
    '' \
    3 \
    success \
    "$(printf 'New Card One\nNew Card Two')"

echo
# The same duplication happens for any mid-run crash, not just a 404 — the
# documented one being the Gmail daily sending limit. What must hold is that
# the cards already sent are remembered and never sent twice.
#
# "Card Two" can never be e-mailed, and since #11 that no longer aborts the
# run: a failed delivery is ordinary tracked state, so the run carries on and
# "Card Three" goes out behind it. Card Two simply stays owed and is retried
# every run, which is why it never appears.
scenario \
    "mid-run e-mail failure: does not re-send what already went out" \
    '["Card One", "Card Two", "Card Three"]' \
    '[]' \
    'Card Two' \
    3 \
    always \
    "$(printf 'Card One\nCard Three')"

echo
# Issue #10, path 1. previous-results.json only ever arrives from the previous
# run's artifact, and the workflow's `gh run download -n Results || true`
# swallows a failed download, so an absent file means "the remembered list was
# lost", not "no cards have been reported yet". Every card in Scryfall then
# looks new, and the >10,000 reset used to record the entire catalog as
# reported without sending a thing.
sends_and_records_nothing \
    "lost remembered list: records nothing and fails loudly" \
    "$(big_catalog)" \
    ABSENT \
    '["harness***AT***example.com"]'

echo
# The same loss reached through a stale remembered list rather than a missing
# one. `gh run download` with no run-id takes the latest artifact matching the
# name, so it can hand back an old one just as easily as none at all — and a
# list that already knew about cards cannot legitimately fall ten thousand
# behind. Recording the catalog here would lose the lot.
sends_and_records_nothing \
    "stale remembered list: records nothing and fails loudly" \
    "$(big_catalog)" \
    '["Old Card"]' \
    '["harness***AT***example.com"]'

echo
# Issue #10, path 2. broadcast() is a Promise.all over the recipient list, so
# an empty list resolves immediately and every card gets recorded as sent to
# nobody.
sends_and_records_nothing \
    "empty recipient list: is not a vacuous success" \
    '["Card One"]' \
    '[]' \
    '[]'

echo
# The flip side of the two checks above: narrowing the >10,000 reset must not
# break the deliberate bootstrap, which is the only way back once the artifact
# is gone.
bootstrap_adopts_catalog \
    "empty remembered list: bootstraps from the catalog without sending" \
    "$(big_catalog)" \
    10500

echo
discord_failure_is_not_a_loss

echo
partial_email_failure_does_not_duplicate

echo
legacy_ledger_migrates_without_backfill

echo
two_faced_card_is_delivered_whole

echo
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
exit 0
