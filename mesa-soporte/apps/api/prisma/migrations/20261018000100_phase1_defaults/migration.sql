-- Default data for phase 1 (all editable by administrators).

INSERT INTO "ticket_priorities" ("id", "name", "rank", "is_default", "active") VALUES
  ('00000000-0000-4000-8000-000000000101', '1 baja', 1, false, true),
  ('00000000-0000-4000-8000-000000000102', '2 normal', 2, true, true),
  ('00000000-0000-4000-8000-000000000103', '3 alta', 3, false, true),
  ('00000000-0000-4000-8000-000000000104', '4 crítica', 4, false, true);

INSERT INTO "business_calendars" ("id", "name", "timezone", "hours", "holidays", "mexico_statutory", "is_default", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000201', 'México — oficina (L–V 9:00–18:30)', 'America/Mexico_City',
   '{"1":[["09:00","18:30"]],"2":[["09:00","18:30"]],"3":[["09:00","18:30"]],"4":[["09:00","18:30"]],"5":[["09:00","18:30"]]}',
   ARRAY[]::text[], true, true, now());

INSERT INTO "groups" ("id", "name", "follow_up", "is_triage", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000301', 'Soporte N1', 'reopen', false, now()),
  ('00000000-0000-4000-8000-000000000302', 'Soporte N2', 'reopen', false, now()),
  ('00000000-0000-4000-8000-000000000303', 'Soporte N3', 'reopen', false, now()),
  ('00000000-0000-4000-8000-000000000304', 'Por verificar', 'new_ticket', true, now());

INSERT INTO "slas" ("id", "name", "conditions", "calendar_id", "pause_on_pending", "warn_percent", "position", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000401', 'Estándar', '{"op":"and","conditions":[]}',
   '00000000-0000-4000-8000-000000000201', true, 80, 100, now());

-- Example targets (prompt, pending decision 3): response / solution in business hours.
INSERT INTO "sla_targets" ("sla_id", "priority_id", "first_response_minutes", "update_minutes", "solution_minutes") VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000104', 60, 120, 240),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000103', 120, 240, 480),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000102', 240, 480, 1440),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000101', 480, 960, 2400);

INSERT INTO "overviews" ("id", "name", "slug", "conditions", "columns", "order_by", "order_dir", "roles", "position", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000501', 'Mis tickets', 'mis-tickets',
   '{"op":"and","conditions":[{"field":"ticket.owner_id","operator":"is","value":"current_user"},{"field":"ticket.state","operator":"in","value":["new","open","pending_reminder","pending_close"]}]}',
   ARRAY['number','title','customer','state','priority','sla','updated_at'], 'escalation_at', 'asc', ARRAY['ADMIN','AGENT'], 10, now()),
  ('00000000-0000-4000-8000-000000000502', 'Mis pendientes alcanzados', 'mis-pendientes',
   '{"op":"and","conditions":[{"field":"ticket.owner_id","operator":"is","value":"current_user"},{"field":"ticket.state","operator":"is","value":"pending_reminder"},{"field":"ticket.pending_until","operator":"before_relative","value":{"minutes":0}}]}',
   ARRAY['number','title','customer','pending_until','updated_at'], 'pending_until', 'asc', ARRAY['ADMIN','AGENT'], 20, now()),
  ('00000000-0000-4000-8000-000000000503', 'Sin asignar', 'sin-asignar',
   '{"op":"and","conditions":[{"field":"ticket.owner_id","operator":"not_set"},{"field":"ticket.state","operator":"in","value":["new","open"]}]}',
   ARRAY['number','title','customer','group','priority','sla','created_at'], 'created_at', 'asc', ARRAY['ADMIN','AGENT'], 30, now()),
  ('00000000-0000-4000-8000-000000000504', 'Escalados', 'escalados',
   '{"op":"and","conditions":[{"field":"ticket.escalation_at","operator":"before_relative","value":{"minutes":0}},{"field":"ticket.state","operator":"in","value":["new","open"]}]}',
   ARRAY['number','title','customer','owner','group','sla'], 'escalation_at', 'asc', ARRAY['ADMIN','AGENT'], 40, now()),
  ('00000000-0000-4000-8000-000000000505', 'Todos los abiertos', 'abiertos',
   '{"op":"and","conditions":[{"field":"ticket.state","operator":"in","value":["new","open","pending_reminder","pending_close"]}]}',
   ARRAY['number','title','customer','owner','group','state','priority','updated_at'], 'updated_at', 'desc', ARRAY['ADMIN','AGENT'], 50, now()),
  ('00000000-0000-4000-8000-000000000506', 'Por verificar', 'por-verificar',
   '{"op":"and","conditions":[{"field":"ticket.group_id","operator":"is","value":"00000000-0000-4000-8000-000000000304"},{"field":"ticket.state","operator":"in","value":["new","open"]}]}',
   ARRAY['number','title','unverified_from','created_at'], 'created_at', 'asc', ARRAY['ADMIN','AGENT'], 60, now()),
  ('00000000-0000-4000-8000-000000000511', 'Mis tickets abiertos', 'mis-abiertos',
   '{"op":"and","conditions":[{"field":"ticket.customer_id","operator":"is","value":"current_user"},{"field":"ticket.state","operator":"in","value":["new","open","pending_reminder","pending_close"]}]}',
   ARRAY['number','title','state','updated_at'], 'updated_at', 'desc', ARRAY['CUSTOMER'], 10, now()),
  ('00000000-0000-4000-8000-000000000512', 'Mis tickets cerrados', 'mis-cerrados',
   '{"op":"and","conditions":[{"field":"ticket.customer_id","operator":"is","value":"current_user"},{"field":"ticket.state","operator":"in","value":["resolved","closed"]}]}',
   ARRAY['number','title','state','updated_at'], 'updated_at', 'desc', ARRAY['CUSTOMER'], 20, now()),
  ('00000000-0000-4000-8000-000000000513', 'Abiertos de mi organización', 'organizacion',
   '{"op":"and","conditions":[{"field":"ticket.state","operator":"in","value":["new","open","pending_reminder","pending_close"]}]}',
   ARRAY['number','title','customer','state','updated_at'], 'updated_at', 'desc', ARRAY['CUSTOMER'], 30, now());

INSERT INTO "activity_types" ("id", "name") VALUES
  ('00000000-0000-4000-8000-000000000601', 'Atención'),
  ('00000000-0000-4000-8000-000000000602', 'Análisis'),
  ('00000000-0000-4000-8000-000000000603', 'Configuración'),
  ('00000000-0000-4000-8000-000000000604', 'Capacitación');

-- Custom fields required by the prompt (section 3). Editable by admins.
INSERT INTO "object_attributes" ("id", "object", "name", "label", "label_en", "data_type", "options", "required", "visible_to_customer", "editable_by_customer", "position", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000701', 'ticket', 'inncentives_environment', 'Ambiente', 'Environment', 'select',
   '[{"value":"dev","label":"Dev"},{"value":"qa","label":"QA"},{"value":"prod","label":"Prod"}]', false, true, true, 10, now()),
  ('00000000-0000-4000-8000-000000000702', 'ticket', 'inncentives_module', 'Módulo de Inncentives', 'Inncentives module', 'select',
   '[{"value":"organizacion","label":"Organización"},{"value":"beneficiarios","label":"Beneficiarios"},{"value":"tablas","label":"Tablas dinámicas"},{"value":"carga","label":"Carga de datos"},{"value":"calendarios","label":"Calendarios"},{"value":"planes","label":"Planes de compensación"},{"value":"procesos","label":"Procesos calendarizados"},{"value":"flujos","label":"Flujos"},{"value":"reportes","label":"Reportes"},{"value":"portal","label":"Portal"},{"value":"centro_comando","label":"Centro de Comando"},{"value":"seguridad","label":"Seguridad/Usuarios"},{"value":"api","label":"API"},{"value":"otro","label":"Otro"}]',
   false, true, true, 20, now()),
  ('00000000-0000-4000-8000-000000000703', 'ticket', 'category', 'Categoría', 'Category', 'select',
   '[{"value":"incidente","label":"Incidente"},{"value":"duda","label":"Duda de uso"},{"value":"cambio","label":"Solicitud de cambio"},{"value":"calculo","label":"Error en cálculo"},{"value":"carga","label":"Carga de datos"},{"value":"acceso","label":"Acceso/usuarios"},{"value":"facturacion","label":"Facturación"}]',
   false, true, true, 30, now()),
  ('00000000-0000-4000-8000-000000000704', 'ticket', 'impact', 'Impacto', 'Impact', 'select',
   '[{"value":"bloquea","label":"Bloquea la operación"},{"value":"parcial","label":"Afecta parcialmente"},{"value":"sin_impacto","label":"Sin impacto inmediato"}]',
   false, true, true, 40, now()),
  ('00000000-0000-4000-8000-000000000705', 'ticket', 'inncentives_version', 'Versión de Inncentives', 'Inncentives version', 'text', '[]', false, true, true, 50, now()),
  ('00000000-0000-4000-8000-000000000706', 'ticket', 'plan_name', 'Plan de compensación', 'Compensation plan', 'text', '[]', false, true, true, 60, now()),
  ('00000000-0000-4000-8000-000000000707', 'ticket', 'process_execution_id', 'ID de ejecución de proceso', 'Process execution ID', 'text', '[]', false, true, true, 70, now());

-- Retention exists from day one but stays disabled until Neitek defines periods.
INSERT INTO "retention_policies" ("id", "target", "days", "active", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000801', 'attachments_closed_tickets', 365, false, now()),
  ('00000000-0000-4000-8000-000000000802', 'anonymize_closed_tickets', 1825, false, now());

INSERT INTO "app_settings" ("key", "value", "updated_at") VALUES
  ('ticket_hook', '"Ticket#"', now()),
  ('time_accounting', '{"enabled":true,"required":false}', now()),
  ('customer_can_close', 'true', now()),
  ('auto_reply_limit_per_hour', '5', now()),
  ('privacy_notice', '{"es":"Tratamos tus datos personales conforme a nuestro aviso de privacidad. Evita compartir datos de empleados (RFC, CURP, NSS, CLABE o sueldos) en los tickets.","en":"We process your personal data according to our privacy notice. Do not share employee data (tax IDs, social security numbers, bank accounts or salaries) in tickets."}', now());
