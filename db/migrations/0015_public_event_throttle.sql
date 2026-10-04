-- Throttle the public `viewed` / `downloaded` events.
--
-- log_public_invoice_event is callable without a session: anyone holding a
-- share link can call it, as often as they can reload the page. Each call
-- inserted an invoice_events row, and each row fans out (via the
-- invoice_events_enqueue_webhooks trigger) into one webhook_deliveries row per
-- subscribed endpoint. So a link holder with a refresh loop could grow two
-- tables without bound and flood the owner's webhook receiver.
--
-- The fix keeps the signal and drops the noise: at most one event of each type
-- per invoice per 10 minutes. "The client opened it" stays true; "the client
-- opened it 40,000 times" was never information.
--
-- The advisory lock serialises concurrent calls for the same invoice so two
-- simultaneous reloads can't both pass the check. Same signature, owner and
-- grants as 0011's version; only the body changes.

create or replace function public.log_public_invoice_event(
  p_token uuid,
  p_type invoice_event_type
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  if p_type not in ('viewed', 'downloaded') then
    raise exception 'Only viewed and downloaded may be logged publicly';
  end if;

  select id into v_invoice_id
  from public.invoices
  where public_token = p_token
    and status <> 'draft'
    and status <> 'void';

  if v_invoice_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('public_event:' || v_invoice_id::text || ':' || p_type::text));

  -- Served by invoice_events_invoice_idx (invoice_id, created_at desc).
  if exists (
    select 1 from public.invoice_events e
    where e.invoice_id = v_invoice_id
      and e.type = p_type
      and e.created_at > now() - interval '10 minutes'
  ) then
    return;
  end if;

  insert into public.invoice_events (invoice_id, type)
  values (v_invoice_id, p_type);
end;
$$;

revoke all on function public.log_public_invoice_event(uuid, invoice_event_type) from public;
grant execute on function public.log_public_invoice_event(uuid, invoice_event_type) to anon, authenticated;
