-- 账号备注拆成对外 / 内部。已有的 remark 一律收进 internalRemark，对外清空。
-- 这样旧备注（可能含成本、联系人等）不会继续出现在大厅。
-- 只处理还没有 internalRemark 的行；已经拆分过的不动。
UPDATE "Account"
SET payload = jsonb_set(
  jsonb_set(
    payload,
    '{internalRemark}',
    to_jsonb(COALESCE(payload->>'remark', '')),
    true
  ),
  '{remark}',
  '""'::jsonb,
  true
)
WHERE NOT (payload ? 'internalRemark');
