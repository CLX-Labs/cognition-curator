--
-- PostgreSQL database dump
--

-- Dumped from database version 15.13
-- Dumped by pg_dump version 15.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: cardstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cardstatus AS ENUM (
    'NEW',
    'LEARNING',
    'REVIEW',
    'MASTERED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: decks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decks (
    id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    category character varying(100),
    user_id uuid NOT NULL,
    is_public boolean NOT NULL,
    is_active boolean NOT NULL,
    color character varying(7) NOT NULL,
    icon character varying(50),
    spaced_repetition_enabled boolean NOT NULL,
    daily_goal_cards integer NOT NULL,
    max_new_cards_per_day integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_studied_at timestamp with time zone,
    total_cards integer NOT NULL,
    cards_due_count integer NOT NULL,
    cards_new_count integer NOT NULL,
    cards_learning_count integer NOT NULL,
    cards_mastered_count integer NOT NULL,
    average_accuracy double precision NOT NULL,
    average_study_time_per_card double precision NOT NULL,
    total_study_time_minutes integer NOT NULL,
    total_reviews integer NOT NULL,
    tags jsonb NOT NULL,
    custom_fields jsonb NOT NULL,
    ai_generated boolean NOT NULL,
    ai_generation_prompt text,
    ai_model_used character varying(100)
);


--
-- Name: flashcards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flashcards (
    id uuid NOT NULL,
    front text NOT NULL,
    back text NOT NULL,
    hint text,
    explanation text,
    deck_id uuid NOT NULL,
    tags jsonb NOT NULL,
    is_active boolean NOT NULL,
    status public.cardstatus NOT NULL,
    ease_factor double precision NOT NULL,
    interval_days integer NOT NULL,
    repetitions integer NOT NULL,
    next_review_date timestamp with time zone NOT NULL,
    last_reviewed_at timestamp with time zone,
    total_reviews integer NOT NULL,
    correct_reviews integer NOT NULL,
    streak_correct integer NOT NULL,
    longest_streak integer NOT NULL,
    total_study_time_seconds integer NOT NULL,
    average_response_time_seconds double precision NOT NULL,
    perceived_difficulty double precision NOT NULL,
    learning_velocity double precision NOT NULL,
    mistake_count integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    ai_generated boolean NOT NULL,
    ai_generation_prompt text,
    ai_model_used character varying(100),
    custom_fields jsonb NOT NULL,
    source_reference text
);


--
-- Name: learning_insights; Type: TABLE; Schema: public; Owner: -
--

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
    is_read boolean NOT NULL,
    is_dismissed boolean NOT NULL,
    user_rating integer,
    user_feedback text,
    generated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    acted_upon_at timestamp with time zone
);


--
-- Name: performance_metrics; Type: TABLE; Schema: public; Owner: -
--

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
    created_at timestamp with time zone NOT NULL
);


--
-- Name: retention_data; Type: TABLE; Schema: public; Owner: -
--

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
    created_at timestamp with time zone NOT NULL
);


--
-- Name: review_sessions; Type: TABLE; Schema: public; Owner: -
--

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
    hint_used boolean NOT NULL,
    multiple_attempts boolean NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    time_of_day_hour integer NOT NULL,
    day_of_week integer NOT NULL,
    platform character varying(50),
    device_type character varying(50),
    app_version character varying(20),
    tags jsonb NOT NULL,
    custom_fields jsonb NOT NULL
);


--
-- Name: study_sessions; Type: TABLE; Schema: public; Owner: -
--

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
    tags jsonb NOT NULL,
    notes text,
    custom_fields jsonb NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

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
    total_study_time_minutes integer NOT NULL,
    current_streak_days integer NOT NULL,
    longest_streak_days integer NOT NULL,
    total_cards_reviewed integer NOT NULL,
    total_decks_created integer NOT NULL,
    overall_accuracy_rate double precision NOT NULL,
    average_session_length_minutes double precision NOT NULL,
    mastery_rate double precision NOT NULL
);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: decks decks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT decks_pkey PRIMARY KEY (id);


--
-- Name: flashcards flashcards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flashcards
    ADD CONSTRAINT flashcards_pkey PRIMARY KEY (id);


--
-- Name: learning_insights learning_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_insights
    ADD CONSTRAINT learning_insights_pkey PRIMARY KEY (id);


--
-- Name: performance_metrics performance_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_metrics
    ADD CONSTRAINT performance_metrics_pkey PRIMARY KEY (id);


--
-- Name: retention_data retention_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_data
    ADD CONSTRAINT retention_data_pkey PRIMARY KEY (id);


--
-- Name: review_sessions review_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_pkey PRIMARY KEY (id);


--
-- Name: study_sessions study_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_decks_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_decks_user_id ON public.decks USING btree (user_id);


--
-- Name: ix_flashcards_deck_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_flashcards_deck_id ON public.flashcards USING btree (deck_id);


--
-- Name: ix_flashcards_next_review_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_flashcards_next_review_date ON public.flashcards USING btree (next_review_date);


--
-- Name: ix_flashcards_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_flashcards_status ON public.flashcards USING btree (status);


--
-- Name: ix_learning_insights_insight_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_learning_insights_insight_type ON public.learning_insights USING btree (insight_type);


--
-- Name: ix_learning_insights_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_learning_insights_user_id ON public.learning_insights USING btree (user_id);


--
-- Name: ix_performance_metrics_metric_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_performance_metrics_metric_date ON public.performance_metrics USING btree (metric_date);


--
-- Name: ix_performance_metrics_metric_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_performance_metrics_metric_type ON public.performance_metrics USING btree (metric_type);


--
-- Name: ix_performance_metrics_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_performance_metrics_user_id ON public.performance_metrics USING btree (user_id);


--
-- Name: ix_retention_data_flashcard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_retention_data_flashcard_id ON public.retention_data USING btree (flashcard_id);


--
-- Name: ix_retention_data_measurement_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_retention_data_measurement_date ON public.retention_data USING btree (measurement_date);


--
-- Name: ix_retention_data_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_retention_data_user_id ON public.retention_data USING btree (user_id);


--
-- Name: ix_review_sessions_deck_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_review_sessions_deck_id ON public.review_sessions USING btree (deck_id);


--
-- Name: ix_review_sessions_flashcard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_review_sessions_flashcard_id ON public.review_sessions USING btree (flashcard_id);


--
-- Name: ix_review_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_review_sessions_user_id ON public.review_sessions USING btree (user_id);


--
-- Name: ix_study_sessions_deck_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_study_sessions_deck_id ON public.study_sessions USING btree (deck_id);


--
-- Name: ix_study_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_study_sessions_user_id ON public.study_sessions USING btree (user_id);


--
-- Name: ix_users_apple_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_apple_id ON public.users USING btree (apple_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: decks decks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT decks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: flashcards flashcards_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flashcards
    ADD CONSTRAINT flashcards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id);


--
-- Name: learning_insights learning_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_insights
    ADD CONSTRAINT learning_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: performance_metrics performance_metrics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_metrics
    ADD CONSTRAINT performance_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: retention_data retention_data_flashcard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_data
    ADD CONSTRAINT retention_data_flashcard_id_fkey FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id);


--
-- Name: retention_data retention_data_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_data
    ADD CONSTRAINT retention_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: review_sessions review_sessions_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id);


--
-- Name: review_sessions review_sessions_flashcard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_flashcard_id_fkey FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id);


--
-- Name: review_sessions review_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: study_sessions study_sessions_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id);


--
-- Name: study_sessions study_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--
