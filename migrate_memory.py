import json
import os
import re

base_dir = r"C:\Users\charl\.gemini\antigravity\brain\d5700662-daef-43a4-b45a-f14d29a2583c\.system_generated\steps"
steps = ["293", "294", "295", "296"]

all_rows = []

for step in steps:
    path = os.path.join(base_dir, step, "output.txt")
    if not os.path.exists(path):
        print("Path not found: " + path)
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
        try:
            data = json.loads(content)
            result_text = data.get("result", "")
            
            # Use non-greedy match to find JSON arrays between tags
            # The tags often have a UUID suffix.
            pattern = re.compile(r"<untrusted-data[^>]*>\s*(\[.*?\])\s*</untrusted-data[^>]*>", re.DOTALL)
            matches = pattern.findall(result_text)
            
            for i, json_str in enumerate(matches):
                cleaned_str = json_str.strip()
                if not cleaned_str:
                    continue
                try:
                    rows = json.loads(cleaned_str)
                    if isinstance(rows, list):
                        all_rows.extend(rows)
                except Exception as inner_e:
                    print("Error parsing JSON inner match " + str(i) + " in " + step + ": " + str(inner_e))
        except Exception as e:
            print("Error parsing file " + step + ": " + str(e))

print("Total rows extracted: " + str(len(all_rows)))

def escape_sql(val):
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    # Basic SQL injection escaping for single quotes
    return "'" + str(val).replace("'", "''") + "'"

chunk_size = 500
output_dir = r"C:\Users\charl\Downloads\SPbot\migration_sql"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

if len(all_rows) > 0:
    for i in range(0, len(all_rows), chunk_size):
        chunk = all_rows[i:i + chunk_size]
        values = []
        for row in chunk:
            id_val = escape_sql(row.get("id"))
            user_id = escape_sql(row.get("user_id"))
            role = escape_sql(row.get("role"))
            content_val = escape_sql(row.get("content"))
            created_at = escape_sql(row.get("created_at"))
            thread_id = escape_sql(row.get("thread_id"))
            msg_id = escape_sql(row.get("msg_id"))
            
            values.append("(" + id_val + ", " + user_id + ", " + role + ", " + content_val + ", " + created_at + ", " + thread_id + ", " + msg_id + ")")
        
        sql = "INSERT INTO public.memory (id, user_id, role, content, created_at, thread_id, msg_id) VALUES\n" + ",\n".join(values) + "\nON CONFLICT (id) DO NOTHING;"
        
        file_name = "memory_chunk_" + str(i//chunk_size + 1) + ".sql"
        with open(os.path.join(output_dir, file_name), "w", encoding="utf-8") as f:
            f.write(sql)
        print("Wrote " + file_name)
else:
    print("No rows to write.")
