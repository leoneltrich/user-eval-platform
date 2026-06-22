#!/usr/bin/env python3
import argparse
import hashlib
import sys

def hash_email(email: str) -> str:
    return hashlib.sha256(email.lower().strip().encode('utf-8')).hexdigest()

def main():
    parser = argparse.ArgumentParser(
        description="Convert a list of plaintext email addresses into SHA-256 hashes for use in permitted_emails.txt"
    )
    parser.add_argument(
        "-i", "--input", 
        default="emails.txt", 
        help="Path to input text file containing plaintext emails (one per line). Default is 'emails.txt'"
    )
    parser.add_argument(
        "-o", "--output", 
        default="permitted_emails.txt", 
        help="Path to output text file where hashes will be written. Default is 'permitted_emails.txt'"
    )
    parser.add_argument(
        "--keep-comments", 
        action="store_true", 
        default=True, 
        help="Preserve comment lines starting with '#' (default: True)"
    )
    parser.add_argument(
        "--no-comments", 
        dest="keep_comments", 
        action="store_false", 
        help="Do not preserve comment lines in output"
    )

    args = parser.parse_args()

    try:
        with open(args.input, "r") as infile:
            lines = infile.readlines()
    except FileNotFoundError:
        print(f"Error: Input file '{args.input}' not found.", file=sys.stderr)
        print("Please create it with one email per line, or specify the path using -i.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error reading '{args.input}': {e}", file=sys.stderr)
        sys.exit(1)

    out_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out_lines.append("")  # preserve blank lines
            continue
        
        if stripped.startswith("#"):
            if args.keep_comments:
                out_lines.append(line.rstrip())
            continue

        # Compute hash
        try:
            email_hash = hash_email(stripped)
            out_lines.append(email_hash)
        except Exception as e:
            print(f"Warning: Could not process line '{stripped}': {e}", file=sys.stderr)

    try:
        with open(args.output, "w") as outfile:
            outfile.write("\n".join(out_lines) + "\n")
        print(f"Successfully processed emails from '{args.input}' and wrote hashes to '{args.output}'.")
    except Exception as e:
        print(f"Error writing to '{args.output}': {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
