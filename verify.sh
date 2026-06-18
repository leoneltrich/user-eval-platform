#!/bin/bash

TASK=$1

if [[ -z "$TASK" ]]; then
    echo "Usage: ./verify [1|2|3]"
    echo "Example: ./verify 1"
    exit 1
fi

echo "=== OPS-SYNC VERIFIER (TASK $TASK) ==="
echo "-------------------------------------"

case $TASK in
    1)
        if [ ! -f ".ops-lock" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Target state origin file '.ops-lock' was not found in the current directory."
            exit 1
        fi

        # Check internal keys
        HAS_MODE=$(grep -c "mode=secure" ".ops-lock")
        HAS_ENV=$(grep -c "env=prod" ".ops-lock")

        if [ "$HAS_MODE" -eq 1 ] && [ "$HAS_ENV" -eq 1 ]; then
            echo "STATUS: SUCCESS"
            echo "MESSAGE: Matrix initialization successfully validated for production environment."
        else
            echo "STATUS: FAILED"
            echo "DETECTION DELTA:"
            [ "$HAS_MODE" -ne 1 ] && echo "  - Missing or incorrect key: expected 'mode=secure'"
            [ "$HAS_ENV" -ne 1 ] && echo "  - Missing or incorrect key: expected 'env=prod'"
            exit 1
        fi
        ;;

    2)
        if [ ! -f "data.txt" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Critical file 'data.txt' is missing from the workspace entirely."
            exit 1
        fi

        # Check if the last line matches the exact payload
        LAST_LINE=$(tail -n 1 "data.txt")
        if [ "$LAST_LINE" = "[LEGACY-V2]" ]; then
            echo "STATUS: SUCCESS"
            echo "MESSAGE: Legacy string payload appended and stream rotation verified."
        else
            echo "STATUS: FAILED"
            echo "DETECTION DELTA:"
            echo "  - File state unchanged or corrupted. Expected '[LEGACY-V2]' on the final line."
            echo "  - Current trailing payload segment: '$LAST_LINE'"
            exit 1
        fi
        ;;

    3)
        if [ ! -f "clean.log" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Pipeline export log 'clean.log' was not generated."
            exit 1
        fi

        if [ ! -f "data.txt" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: 'data.txt' was deleted or moved. The task requires an in-place modification."
            exit 1
        fi

        # Check if PASSWORD still exists in data.txt
        REMAINING_CREDS=$(grep -n "PASSWORD" "data.txt")

        if [ -z "$REMAINING_CREDS" ]; then
            echo "STATUS: SUCCESS"
            echo "MESSAGE: In-place data sanitization and log routing verified."
        else
            echo "STATUS: FAILED"
            echo "DETECTION DELTA:"
            echo "  - Sensitive credentials still remain inside data.txt on the following lines:"
            echo "$REMAINING_CREDS"
            exit 1
        fi
        ;;

    *)
        echo "Invalid task selection. Please use choose 1, 2, or 3."
        exit 1
        ;;
esac