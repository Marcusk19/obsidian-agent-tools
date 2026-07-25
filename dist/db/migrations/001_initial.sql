CREATE TABLE IF NOT EXISTS summaries (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    date        TEXT NOT NULL,
    cwd         TEXT,
    topic       TEXT,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(date);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS summary_fts USING fts5(
    content,
    topic UNINDEXED,
    session_id UNINDEXED,
    cwd UNINDEXED,
    date UNINDEXED,
    created_at UNINDEXED,
    tokenize = 'porter'
);

CREATE TABLE IF NOT EXISTS summary_vec_map (
    summary_id TEXT PRIMARY KEY,
    vec_rowid  INTEGER NOT NULL
);
