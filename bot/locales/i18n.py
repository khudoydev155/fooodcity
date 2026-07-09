import json
import os

def get_i18n(user_id=None, lang="uz"):
    locales_dir = os.path.dirname(__file__)
    file_path = os.path.join(locales_dir, f"{lang}.json")
    
    if not os.path.exists(file_path):
        file_path = os.path.join(locales_dir, "uz.json")
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
