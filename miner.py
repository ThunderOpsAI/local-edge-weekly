import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("Error: GEMINI_API_KEY not found in .env")
    exit(1)

# Trying 'gemini-1.5-flash'
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key={api_key}"

prompt = "Explain why Pinsent Hotel might be considered an 'underdog' compared to Old Town and Country Tavern, Wangaratta Club, and Wangaratta RSL in the Wangaratta pub scene. Compare reputation, history, or vibe."

payload = {
    "contents": [{
        "parts": [{"text": prompt}]
    }]
}

headers = {
    "Content-Type": "application/json"
}

try:
    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        # Fallback to gemini-pro if 404
        if response.status_code == 404:
            print("Retrying with gemini-pro...")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={api_key}"
            response = requests.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                 print(f"Fallback Error: {response.status_code}")
                 print(response.text)
                 exit(1)
    
    data = response.json()
    
    # Extract the text from the response
    try:
        if 'candidates' in data and data['candidates']:
            text_content = data['candidates'][0]['content']['parts'][0]['text']
            print(text_content)
        else:
            print("No candidates return.")
            print(json.dumps(data, indent=2))
    except (KeyError, IndexError) as e:
        print(f"Error parsing response: {e}")
        print(f"Full response: {json.dumps(data, indent=2)}")

except requests.exceptions.RequestException as e:
    print(f"API Request failed: {e}")
