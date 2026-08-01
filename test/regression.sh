#!/usr/bin/env bash
# Regression tests for the two ways this notifier can misreport what it sent:
# issue #8 (a card is notified twice) and issue #10 (a card is recorded as
# notified when nothing went out).
#
# There is no seam inside src/main.ts to test against: it is one top-level
# async IIFE, and both bugs live in the interaction between a mid-run crash,
# the process exit code, and the GitHub Actions artifact hand-off. So the seam
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
            SECRET_GMAIL_APP_PASSWORD=test \
            SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK=https://discord.invalid/a \
            SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK=https://discord.invalid/b \
            TS_NODE_PROJECT="$REPO/tsconfig.json" \
            npx --yes ts-node -r "$REPO/test/mock-services.js" \
            "$REPO/src/main.ts" \
            >"$sandbox/$log_name" 2>&1
    )
}

# the cards that a notify log says really went out, one name per line
notified_names() {
    grep -oE 'New Card: \[\[[^]]*\]\]' "$1" 2>/dev/null |
        sed -E 's/New Card: \[\[(.*)\]\]/\1/'
}

# the card names inside a results.json / previous-results.json, one per line. A
# file that is absent, unreadable or not a JSON array contributes no names,
# which is exactly how the notifier should be judged: it recorded nothing
recorded_names() {
    node -e '
        const fs = require("fs");
        try {
            const names = JSON.parse(fs.readFileSync(process.argv[1]).toString());
            if (Array.isArray(names)) {
                names.forEach((name) => process.stdout.write(`${name}\n`));
            }
        } catch (error) {
            // absent or unreadable
        }
    ' "$1"
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

    # names the run claims it reported, minus the ones it was already allowed
    # to claim because a previous run reported them
    local unsent
    unsent="$(comm -23 \
        <(comm -23 <(recorded_names "$sandbox/results.json" | sort -u) \
            <(recorded_names "$sandbox/previous-results.json" | sort -u)) \
        <(notified_names "$sandbox/notified.txt" | sort -u))"

    local sent_count
    sent_count="$(notified_names "$sandbox/notified.txt" | wc -l)"

    local kept=false

    if [ -z "$unsent" ]; then
        pass "records nothing that was not sent"
    else
        fail "$(echo "$unsent" | wc -l) name(s) recorded as reported without being sent, e.g.:"
        echo "$unsent" | head -3 | sed 's/^/        /'
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
# documented one being the Gmail daily sending limit. Here the crash is
# unavoidable, so what must hold is that the cards already sent are remembered
# and never sent twice.
scenario \
    "mid-run e-mail failure: does not re-send what already went out" \
    '["Card One", "Card Two", "Card Three"]' \
    '[]' \
    'Card Two' \
    3 \
    always \
    "Card One"

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
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
exit 0
