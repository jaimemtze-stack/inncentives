-- AuditLog is append-only: the application role may INSERT and SELECT only.
CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();

-- Full-text search (Spanish + English) without Elasticsearch.
ALTER TABLE tickets ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(number, '') || ' ' || coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'B')
  ) STORED;
CREATE INDEX tickets_search_idx ON tickets USING GIN (search_vector);

ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(subject, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(left("bodyText", 100000), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(left("bodyText", 100000), '')), 'D')
  ) STORED;
CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);

ALTER TABLE users ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(firstname, '') || ' ' || coalesce(lastname, '') || ' ' || coalesce(email, ''))
  ) STORED;
CREATE INDEX users_search_idx ON users USING GIN (search_vector);

ALTER TABLE organizations ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED;
CREATE INDEX organizations_search_idx ON organizations USING GIN (search_vector);
