import os
import traceback
import google.generativeai as genai

# 1. Pull key from the Antigravity Vault
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY not found in environment variables.")
else:
    # Print masked key for verification
    print(f"DEBUG: Key loaded: {api_key[:5]}...{api_key[-3:]}")

genai.configure(api_key=api_key)

# 2. Initialize the Model (using Flash for cost-efficiency)
model = genai.GenerativeModel('gemini-2.0-flash')

test_prompt = """
Handshake Test: Verify project context for 'Local Edge Weekly'.
Market: Chapel St, Prahran.
Targets: Tall Timber, Crooked Letters, Reverie Cafe.
Task: Briefly identify ONE unique selling point for each Target based on your internal knowledge.
"""

try:
    response = model.generate_content(test_prompt)
    print("--- HANDSHAKE SUCCESSFUL ---")
    print(response.text)
except Exception as e:
    print("--- HANDSHAKE FAILED ---")
    print(traceback.format_exc())
    print(f"Error: {repr(e)}")