#!/bin/bash

# Railway Database Initialization Script
# This script is run on Railway deployment to ensure the database is properly set up

set -e

echo "🚀 Starting Railway database initialization..."

# Check if we're in production environment
if [ "$RAILWAY_ENVIRONMENT" != "production" ]; then
    echo "⚠️  Warning: Not running in production environment"
fi

# Wait for database to be available
echo "📊 Checking database connectivity..."
python -c "
import os
import psycopg2
import time
import sys

db_url = os.environ.get('DATABASE_URL')
if not db_url:
    print('❌ DATABASE_URL not set')
    sys.exit(1)

max_retries = 30
for i in range(max_retries):
    try:
        conn = psycopg2.connect(db_url)
        conn.close()
        print('✅ Database is ready')
        break
    except psycopg2.OperationalError:
        if i == max_retries - 1:
            print('❌ Database connection failed after 30 attempts')
            sys.exit(1)
        print(f'⏳ Waiting for database... ({i+1}/{max_retries})')
        time.sleep(2)
"

# Create necessary extensions
echo "🔧 Creating required database extensions..."
python -c "
import os
import psycopg2
from urllib.parse import urlparse

db_url = os.environ.get('DATABASE_URL')
result = urlparse(db_url)
database = result.path[1:]
username = result.username
password = result.password
hostname = result.hostname
port = result.port

try:
    conn = psycopg2.connect(
        database=database,
        user=username,
        password=password,
        host=hostname,
        port=port
    )
    cursor = conn.cursor()
    cursor.execute('CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";')
    conn.commit()
    conn.close()
    print('✅ UUID extension created')
except Exception as e:
    print(f'❌ Failed to create extensions: {e}')
    raise
"

# Run database migrations
echo "📈 Running database migrations..."
python -m flask db upgrade

# Check migration status
echo "🔍 Verifying migration status..."
python -m flask db current

echo "✅ Railway database initialization complete!"
echo "🚀 Starting application with gunicorn..."
