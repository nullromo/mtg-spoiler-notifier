#!/usr/bin/env bash
# Regression tests for issue #8 — duplicate notifications.
#
# There is no seam inside src/main.ts to test against: it is one top-level
# async IIFE, and the bug lives in the interaction between a mid-run crash,
# the process exit code, and the GitHub Actions artifact hand-off. So the seam
# used here is the process boundary — run the whole notifier, repeatedly,
# against fake services (test/mock-services.js) and assert on which
# notifications actually went out.
#
# Each scenario chains N runs and reproduces the artifact hand-off from
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
    sandbox="$(mktemp -d)"
    mkdir -p "$sandbox/images"
    echo '["harness***AT***example.com"]' >"$sandbox/recipients.json"
    echo '[]' >"$sandbox/previous-results.json"
    echo "$catalog" >"$sandbox/catalog.json"
    : >"$sandbox/all-notified.txt"

    local n rc
    for n in $(seq 1 "$runs"); do
        : >"$sandbox/notified-run$n.txt"
        (
            cd "$sandbox" || exit 99
            NOTIFY_LOG="$sandbox/notified-run$n.txt" \
                HARNESS_CATALOG="$sandbox/catalog.json" \
                HARNESS_BROKEN="$broken" \
                HARNESS_EMAIL_FAILS_ON="$email_fails_on" \
                SECRET_GMAIL_APP_PASSWORD=test \
                SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK=https://discord.invalid/a \
                SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK=https://discord.invalid/b \
                TS_NODE_PROJECT="$REPO/tsconfig.json" \
                npx --yes ts-node -r "$REPO/test/mock-services.js" \
                "$REPO/src/main.ts" \
                >"$sandbox/run$n.log" 2>&1
        )
        rc=$?

        grep -oE 'New Card: \[\[[^]]*\]\]' "$sandbox/notified-run$n.txt" 2>/dev/null |
            sed -E 's/New Card: \[\[(.*)\]\]/\1/' >>"$sandbox/all-notified.txt"

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
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
exit 0
