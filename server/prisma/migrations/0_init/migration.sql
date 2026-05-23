-- Baseline migration representing the existing Flask/Alembic schema.
-- This migration is NEVER run against an existing database —
-- the start.js script marks it as already applied before running
-- `prisma migrate deploy` on a pre-existing Railway Postgres instance.
-- It IS run on fresh databases (CI, local dev, new environments).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE public.cardstatus AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'MASTERED');

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    apple_id character varying(255),
    name character varying(100) NOT NULL,
    display_name character varying(100),
    profile_picture_url text,
    is_active boolean NOT NULL,
    is_premium boolean NOT NULL,
    email_verified boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_login_at timestamp with time zone,
    study_preferences jsonb NOT NULL,
    timezone character varying(50) NOT NULL,
    language_preference character varying(10) NOT NULL,
    total_study_time_minutes integer NOT NULL DEFAULT 0,
    current_streak_days integer NOT NULL DEFAULT 0,
    longest_streak_days integer NOT NULL DEFAULT 0,
    total_cards_reviewed integer NOT NULL DEFAULT 0,
    total_decks_created integer NOT NULL DEFAULT 0,
    overall_accuracy_rate double precision NOT NULL DEFAULT 0,
    average_session_length_minutes double precision NOT NULL DEFAULT 0,
    mastery_rate double precision NOT NULL DEFAULT 0,
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);
CREATE UNIQUE INDEX ix_users_apple_id ON public.users USING btree (apple_id);

CREATE TABLE public.decks (
    id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    category character varying(100),
    user_id uuid NOT NULL,
    is_public boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    color character varying(7) NOT NULL DEFAULT '#007AFF',
    icon character varying(50),
    spaced_repetition_enabled boolean NOT NULL DEFAULT true,
    daily_goal_cards integer NOT NULL DEFAULT 20,
    max_new_cards_per_day integer NOT NULL DEFAULT 10,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_studied_at timestamp with time zone,
    total_cards integer NOT NULL DEFAULT 0,
    cards_due_count integer NOT NULL DEFAULT 0,
    cards_new_count integer NOT NULL DEFAULT 0,
    cards_learning_count integer NOT NULL DEFAULT 0,
    cards_mastered_count integer NOT NULL DEFAULT 0,
    average_accuracy double precision NOT NULL DEFAULT 0,
    average_study_time_per_card double precision NOT NULL DEFAULT 0,
    total_study_time_minutes integer NOT NULL DEFAULT 0,
    total_reviews integer NOT NULL DEFAULT 0,
    tags jsonb NOT NULL DEFAULT '[]',
    custom_fields jsonb NOT NULL DEFAULT '{}',
    ai_generated boolean NOT NULL DEFAULT false,
    ai_generation_prompt text,
    ai_model_used character varying(100),
    CONSTRAINT decks_pkey PRIMARY KEY (id),
    CONSTRAINT decks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX ix_decks_user_id ON public.decks USING btree (user_id);

CREATE TABLE public.flashcards (
    id uuid NOT NULL,
    front text NOT NULL,
    back text NOT NULL,
    hint text,
    explanation text,
    deck_id uuid NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]',
    is_active boolean NOT NULL DEFAULT true,
    status public.cardstatus NOT NULL DEFAULT 'NEW',
    ease_factor double precision NOT NULL DEFAULT 2.5,
    interval_days integer NOT NULL DEFAULT 0,
    repetitions integer NOT NULL DEFAULT 0,
    next_review_date timestamp with time zone NOT NULL,
    last_reviewed_at timestamp with time zone,
    total_reviews integer NOT NULL DEFAULT 0,
    correct_reviews integer NOT NULL DEFAULT 0,
    streak_correct integer NOT NULL DEFAULT 0,
    longest_streak integer NOT NULL DEFAULT 0,
    total_study_time_seconds integer NOT NULL DEFAULT 0,
    average_response_time_seconds double precision NOT NULL DEFAULT 0,
    perceived_difficulty double precision NOT NULL DEFAULT 0.5,
    learning_velocity double precision NOT NULL DEFAULT 1.0,
    mistake_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    ai_generated boolean NOT NULL DEFAULT false,
    ai_generation_prompt text,
    ai_model_used character varying(100),
    custom_fields jsonb NOT NULL DEFAULT '{}',
    source_reference text,
    CONSTRAINT flashcards_pkey PRIMARY KEY (id),
    CONSTRAINT flashcards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id)
);

CREATE INDEX ix_flashcards_deck_id ON public.flashcards USING btree (deck_id);
CREATE INDEX ix_flashcards_next_review_date ON public.flashcards USING btree (next_review_date);
CREATE INDEX ix_flashcards_status ON public.flashcards USING btree (status);

CREATE TABLE public.review_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    deck_id uuid NOT NULL,
    flashcard_id uuid NOT NULL,
    difficulty_rating integer NOT NULL,
    was_correct boolean NOT NULL,
    response_time_seconds double precision NOT NULL,
    session_type character varying(50) NOT NULL,
    review_context character varying(100),
    ease_factor_before double precision NOT NULL,
    ease_factor_after double precision NOT NULL,
    interval_before_days integer NOT NULL,
    interval_after_days integer NOT NULL,
    repetitions_before integer NOT NULL,
    repetitions_after integer NOT NULL,
    confidence_level double precision,
    hint_used boolean NOT NULL DEFAULT false,
    multiple_attempts boolean NOT NULL DEFAULT false,
    reviewed_at timestamp with time zone NOT NULL,
    time_of_day_hour integer NOT NULL,
    day_of_week integer NOT NULL,
    platform character varying(50),
    device_type character varying(50),
    app_version character varying(20),
    tags jsonb NOT NULL DEFAULT '[]',
    custom_fields jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT review_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT review_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT review_sessions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id),
    CONSTRAINT review_sessions_flashcard_id_fkey FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id)
);

CREATE INDEX ix_review_sessions_user_id ON public.review_sessions USING btree (user_id);
CREATE INDEX ix_review_sessions_deck_id ON public.review_sessions USING btree (deck_id);
CREATE INDEX ix_review_sessions_flashcard_id ON public.review_sessions USING btree (flashcard_id);

CREATE TABLE public.study_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    deck_id uuid,
    session_type character varying(50) NOT NULL,
    session_name character varying(200),
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_minutes integer NOT NULL,
    cards_reviewed integer NOT NULL,
    cards_correct integer NOT NULL,
    cards_incorrect integer NOT NULL,
    accuracy_rate double precision NOT NULL,
    cards_new_studied integer NOT NULL,
    cards_graduated integer NOT NULL,
    cards_mastered integer NOT NULL,
    cards_reset integer NOT NULL,
    average_response_time_seconds double precision NOT NULL,
    total_think_time_seconds integer NOT NULL,
    fastest_response_seconds double precision,
    slowest_response_seconds double precision,
    session_quality_score double precision NOT NULL,
    focus_score double precision NOT NULL,
    difficulty_distribution jsonb NOT NULL,
    platform character varying(50),
    device_type character varying(50),
    app_version character varying(20),
    interruptions_count integer NOT NULL,
    target_cards integer,
    target_duration_minutes integer,
    goal_achieved boolean NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]',
    notes text,
    custom_fields jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT study_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT study_sessions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id)
);

CREATE INDEX ix_study_sessions_user_id ON public.study_sessions USING btree (user_id);
CREATE INDEX ix_study_sessions_deck_id ON public.study_sessions USING btree (deck_id);

CREATE TABLE public.performance_metrics (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    metric_date date NOT NULL,
    metric_type character varying(20) NOT NULL,
    total_study_time_minutes integer NOT NULL,
    total_sessions integer NOT NULL,
    total_cards_reviewed integer NOT NULL,
    unique_decks_studied integer NOT NULL,
    overall_accuracy double precision NOT NULL,
    average_session_quality double precision NOT NULL,
    cards_mastered integer NOT NULL,
    cards_learned integer NOT NULL,
    study_streak_days integer NOT NULL,
    goal_achievement_rate double precision NOT NULL,
    average_session_length double precision NOT NULL,
    strongest_categories jsonb NOT NULL,
    weakest_categories jsonb NOT NULL,
    improvement_suggestions jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT performance_metrics_pkey PRIMARY KEY (id),
    CONSTRAINT performance_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX ix_performance_metrics_user_id ON public.performance_metrics USING btree (user_id);
CREATE INDEX ix_performance_metrics_metric_date ON public.performance_metrics USING btree (metric_date);
CREATE INDEX ix_performance_metrics_metric_type ON public.performance_metrics USING btree (metric_type);

CREATE TABLE public.learning_insights (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    insight_type character varying(50) NOT NULL,
    category character varying(100) NOT NULL,
    priority character varying(20) NOT NULL,
    title character varying(200) NOT NULL,
    description text NOT NULL,
    action_items jsonb NOT NULL,
    evidence_data jsonb NOT NULL,
    confidence_score double precision NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    is_dismissed boolean NOT NULL DEFAULT false,
    user_rating integer,
    user_feedback text,
    generated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    acted_upon_at timestamp with time zone,
    CONSTRAINT learning_insights_pkey PRIMARY KEY (id),
    CONSTRAINT learning_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX ix_learning_insights_user_id ON public.learning_insights USING btree (user_id);
CREATE INDEX ix_learning_insights_insight_type ON public.learning_insights USING btree (insight_type);

CREATE TABLE public.retention_data (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    flashcard_id uuid NOT NULL,
    measurement_date date NOT NULL,
    days_since_last_review integer NOT NULL,
    retention_strength double precision NOT NULL,
    initial_strength double precision NOT NULL,
    decay_rate double precision NOT NULL,
    stability_factor double precision NOT NULL,
    review_context character varying(100),
    environmental_factors jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT retention_data_pkey PRIMARY KEY (id),
    CONSTRAINT retention_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT retention_data_flashcard_id_fkey FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id)
);

CREATE INDEX ix_retention_data_user_id ON public.retention_data USING btree (user_id);
CREATE INDEX ix_retention_data_flashcard_id ON public.retention_data USING btree (flashcard_id);
CREATE INDEX ix_retention_data_measurement_date ON public.retention_data USING btree (measurement_date);
