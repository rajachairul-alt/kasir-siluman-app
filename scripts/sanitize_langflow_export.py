"""Sanitize a Langflow flow export before committing it.

Usage:  python scripts/sanitize_langflow_export.py <export.json> <out.json>

- Reads UTF-8 or UTF-16 (PowerShell redirects write UTF-16 with a BOM).
- Blanks every template field marked `password` unless it only references a
  Langflow global variable (`load_from_db`), plus any `project_id`.
- Drops account identifiers (user_id, folder_id, workspace_id and the
  per-node `_frontend_node_folder_id`).
- Writes pretty-printed UTF-8 JSON and prints what it blanked (names only).
"""
import json, sys

def read_any(path):
    raw = open(path, "rb").read()
    enc = "utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"
    return json.loads(raw.decode(enc))

def sanitize(flow):
    blanked = []
    for key in ("user_id", "folder_id", "workspace_id"):
        flow.pop(key, None)
    for node in flow.get("data", {}).get("nodes", []):
        tpl = node.get("data", {}).get("node", {}).get("template", {})
        for name, field in tpl.items():
            if not isinstance(field, dict) or name == "code":
                continue
            secret = field.get("password") and not field.get("load_from_db")
            if (secret or name in ("project_id", "_frontend_node_folder_id")) and field.get("value"):
                field["value"] = ""
                blanked.append(f"{node.get('id')}.{name}")
    return blanked

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    flow = read_any(src)
    blanked = sanitize(flow)
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        json.dump(flow, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{dst}: blanked {blanked or 'nothing'}")
