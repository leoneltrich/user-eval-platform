import logging
import asyncpg
from typing import Optional, Dict, Any
from datetime import datetime
import config

logger = logging.getLogger("orchestrator.db")

class DatabaseManager:
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def initialize(self):
        """Initialize the connection pool and create tables if they don't exist."""
        logger.info("Initializing database pool...")
        try:
            self.pool = await asyncpg.create_pool(
                host=config.DB_HOST,
                port=config.DB_PORT,
                user=config.DB_USER,
                password=config.DB_PASSWORD,
                database=config.DB_NAME,
                min_size=2,
                max_size=10
            )
            await self._create_tables()
            logger.info("Database initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise e

    async def close(self):
        """Close the database pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database pool closed.")

    async def _create_tables(self):
        """Create necessary database tables if they do not exist."""
        queries = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email_hash VARCHAR(64) UNIQUE NOT NULL,
                current_task_index INT DEFAULT 0,
                current_question_index INT DEFAULT 0,
                first_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS task_durations (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                task_id INT NOT NULL,
                active_time_seconds INT DEFAULT 0,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                UNIQUE (user_id, task_id)
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS telemetry_events (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                task_id INT,
                event_type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS survey_responses (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                question_id INT NOT NULL,
                question_text TEXT NOT NULL,
                response_type VARCHAR(10) NOT NULL,
                response_value TEXT NOT NULL,
                option_index INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        ]
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for query in queries:
                    await conn.execute(query)

    async def get_or_create_user(self, email_hash: str) -> Dict[str, Any]:
        """Fetch a user by email hash, creating them if they don't exist."""
        async with self.pool.acquire() as conn:
            # Try to get existing user
            row = await conn.fetchrow(
                "SELECT id, email_hash, current_task_index, current_question_index FROM users WHERE email_hash = $1", email_hash
            )
            if row:
                # Update last active timestamp
                await conn.execute(
                    "UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE email_hash = $1", email_hash
                )
                return dict(row)
            
            # Create new user
            await conn.execute(
                "INSERT INTO users (email_hash) VALUES ($1) ON CONFLICT (email_hash) DO NOTHING", email_hash
            )
            row = await conn.fetchrow(
                "SELECT id, email_hash, current_task_index, current_question_index FROM users WHERE email_hash = $1", email_hash
            )
            return dict(row)

    async def update_user_progress(self, email_hash: str, current_task_index: int, current_question_index: int):
        """Update user progress indices using email hash."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE users 
                SET current_task_index = $1, 
                    current_question_index = $2, 
                    last_active_at = CURRENT_TIMESTAMP 
                WHERE email_hash = $3
                """,
                current_task_index, current_question_index, email_hash
            )

    async def log_telemetry_event(self, email_hash: str, task_id: Optional[int], event_type: str):
        """Log a telemetry event (e.g. copy_command, view_solution)."""
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow("SELECT id FROM users WHERE email_hash = $1", email_hash)
            if not user:
                return
            await conn.execute(
                """
                INSERT INTO telemetry_events (user_id, task_id, event_type)
                VALUES ($1, $2, $3)
                """,
                user["id"], task_id, event_type
            )

    async def add_task_duration(self, email_hash: str, task_id: int, seconds: int):
        """Add active seconds to a user's task duration record."""
        if seconds <= 0:
            return
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow("SELECT id FROM users WHERE email_hash = $1", email_hash)
            if not user:
                return
            # Check if duration record exists
            row = await conn.fetchrow(
                "SELECT id FROM task_durations WHERE user_id = $1 AND task_id = $2",
                user["id"], task_id
            )
            if row:
                await conn.execute(
                    """
                    UPDATE task_durations 
                    SET active_time_seconds = active_time_seconds + $1 
                    WHERE user_id = $2 AND task_id = $3
                    """,
                    seconds, user["id"], task_id
                )
            else:
                await conn.execute(
                    """
                    INSERT INTO task_durations (user_id, task_id, active_time_seconds, started_at)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                    """,
                    user["id"], task_id, seconds
                )

    async def finalize_task(self, email_hash: str, task_id: int):
        """Mark a task as completed by setting completed_at timestamp."""
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow("SELECT id FROM users WHERE email_hash = $1", email_hash)
            if not user:
                return
            await conn.execute(
                """
                UPDATE task_durations 
                SET completed_at = CURRENT_TIMESTAMP 
                WHERE user_id = $1 AND task_id = $2 AND completed_at IS NULL
                """,
                user["id"], task_id
            )

    async def save_survey_response(self, email_hash: str, question_id: int, question_text: str, response_type: str, response_value: str, option_index: Optional[int]):
        """Save a survey questionnaire response."""
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow("SELECT id FROM users WHERE email_hash = $1", email_hash)
            if not user:
                return
            # Delete if there's an existing response to this question (resume/update support)
            await conn.execute(
                "DELETE FROM survey_responses WHERE user_id = $1 AND question_id = $2",
                user["id"], question_id
            )
            await conn.execute(
                """
                INSERT INTO survey_responses (user_id, question_id, question_text, response_type, response_value, option_index)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                user["id"], question_id, question_text, response_type, response_value, option_index
            )

    async def get_all_telemetry_data(self) -> Dict[str, Any]:
        """Fetch all telemetry records to build the admin report."""
        async with self.pool.acquire() as conn:
            users = await conn.fetch("SELECT id, email_hash, first_login_at, last_active_at, current_task_index, current_question_index FROM users")
            durations = await conn.fetch("SELECT user_id, task_id, active_time_seconds, started_at, completed_at FROM task_durations")
            events = await conn.fetch("SELECT user_id, task_id, event_type, created_at FROM telemetry_events")
            responses = await conn.fetch("SELECT user_id, question_id, question_text, response_type, response_value, option_index, created_at FROM survey_responses")
            
            # Helper to convert asyncpg Record objects to standard serializable dicts
            def serialize_records(records):
                res = []
                for r in records:
                    d = dict(r)
                    # format datetime fields
                    for k, v in d.items():
                        if isinstance(v, datetime):
                            d[k] = v.isoformat()
                    res.append(d)
                return res

            return {
                "users": serialize_records(users),
                "durations": serialize_records(durations),
                "events": serialize_records(events),
                "survey_responses": serialize_records(responses)
            }

