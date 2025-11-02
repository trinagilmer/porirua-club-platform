-- ============================================================
-- 🧩 Final Fix: Replace integer assigned_to with a proper UUID column
-- ============================================================

-- 1️⃣  Remove any old FK so we can change the column
alter table if exists tasks
  drop constraint if exists fk_tasks_assigned_to,
  drop constraint if exists tasks_assigned_to_fkey;

-- 2️⃣  Add a new UUID column
alter table tasks
  add column assigned_to_uuid uuid;

-- 3️⃣  (Optional)  If you can map integer → contact UUID, do it here.
--      Example if contacts table still has a legacy integer_id column:
-- update tasks t
-- set assigned_to_uuid = c.id
-- from contacts c
-- where t.assigned_to = c.legacy_id;

-- 4️⃣  Otherwise, just leave nulls.
update tasks set assigned_to_uuid = null;

-- 5️⃣  Drop the old integer column
alter table tasks drop column assigned_to;

-- 6️⃣  Rename the new one to keep the same name
alter table tasks rename column assigned_to_uuid to assigned_to;

-- 7️⃣  Re-add the foreign key constraint (both UUID types now)
alter table tasks
  add constraint fk_tasks_assigned_to
  foreign key (assigned_to)
  references contacts(id)
  on delete set null
  on update cascade;

-- ============================================================
-- ✅ Done: assigned_to is now UUID and FK to contacts(id)
-- ============================================================



