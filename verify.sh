#!/bin/bash

TASK=$1

if [[ -z "$TASK" ]]; then
    echo "Usage: ./verify.sh [1|2|3|4|5|6]"
    echo "Example: ./verify.sh 1"
    exit 1
fi

echo "=== OPS-SYNC VERIFIER (TASK $TASK) ==="
echo "-------------------------------------"

case $TASK in
    1)
        # Task 1: Create duplicate of /tmp/data in /tmp/misc
        if [ ! -d "/tmp/misc/data" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Directory '/tmp/misc/data' was not found."
            exit 1
        fi

        if [ ! -f "/tmp/misc/data/file1.txt" ] || [ ! -f "/tmp/misc/data/sub/file2.txt" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Missing files in the duplicated directory."
            exit 1
        fi

        # Check content is not empty or corrupted
        CONTENT1=$(cat /tmp/misc/data/file1.txt 2>/dev/null)
        CONTENT2=$(cat /tmp/misc/data/sub/file2.txt 2>/dev/null)
        if [ "$CONTENT1" != "sample data stream" ] || [ "$CONTENT2" != "nested sample data" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: File contents inside the duplicate directory are incorrect."
            exit 1
        fi

        echo "STATUS: SUCCESS"
        echo "MESSAGE: Directory duplicate successfully created inside /tmp/misc."
        ;;

    2)
        # Task 2: Backup /tmp/results/benchmark to /tmp/backup/ if destination is older
        if [ ! -f "/tmp/backup/benchmark" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: '/tmp/backup/benchmark' does not exist."
            exit 1
        fi

        # Verify the content has been updated
        CONTENT=$(cat /tmp/backup/benchmark 2>/dev/null)
        if [ "$CONTENT" != "new benchmark results v2" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Destination file '/tmp/backup/benchmark' does not contain the updated benchmark data."
            exit 1
        fi

        # Make sure source file was not deleted
        if [ ! -f "/tmp/results/benchmark" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: Source file '/tmp/results/benchmark' is missing."
            exit 1
        fi

        echo "STATUS: SUCCESS"
        echo "MESSAGE: Benchmark successfully backed up to /tmp/backup/ with update constraints."
        ;;

    3)
        # Task 3: Move numbers.txt from /tmp to /tmp/misc/ updating/overwriting existing
        if [ -f "/tmp/numbers.txt" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: 'numbers.txt' still exists in /tmp. It should be moved, not copied."
            exit 1
        fi

        if [ ! -f "/tmp/misc/numbers.txt" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: 'numbers.txt' was not found in /tmp/misc."
            exit 1
        fi

        CONTENT=$(cat /tmp/misc/numbers.txt 2>/dev/null)
        if [ "$CONTENT" != "987654321" ]; then
            echo "STATUS: FAILED"
            echo "ERROR: 'numbers.txt' in /tmp/misc was not updated/overwritten with the new content."
            exit 1
        fi

        echo "STATUS: SUCCESS"
        echo "MESSAGE: 'numbers.txt' successfully moved and updated."
        ;;

    4)
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

    5)
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

    6)
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
        echo "Invalid task selection. Please choose 1, 2, 3, 4, 5, or 6."
        exit 1
        ;;
esac