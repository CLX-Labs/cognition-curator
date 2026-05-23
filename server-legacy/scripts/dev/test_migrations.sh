#!/bin/bash

# Test Migration Setup Script
# This script tests the migration system to ensure it works correctly

set -e

echo "🧪 Testing migration setup..."

# Check if we're in the right directory
if [ ! -f "migrations/env.py" ]; then
    echo "❌ Error: migrations directory not found. Run from server/ directory."
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker first."
    exit 1
fi

echo "🐳 Starting test database..."
docker-compose up -d db

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Test database connection
echo "📊 Testing database connection..."
max_retries=10
for i in $(seq 1 $max_retries); do
    if docker-compose exec -T db psql -U cognition_user -d cognition_curator_dev -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ Database is ready"
        break
    fi
    if [ $i -eq $max_retries ]; then
        echo "❌ Database connection failed after $max_retries attempts"
        exit 1
    fi
    echo "⏳ Waiting for database... ($i/$max_retries)"
    sleep 2
done

# Test migration commands
echo "🔧 Testing migration commands..."

# Check if migration directory is initialized
echo "📁 Checking migration initialization..."
if [ ! -f "migrations/alembic.ini" ]; then
    echo "❌ Error: Migration not initialized"
    exit 1
fi
echo "✅ Migration directory is properly initialized"

# Test migration status
echo "📈 Testing migration status check..."
docker-compose run --rm app python -m flask db current || {
    echo "❌ Failed to check migration status"
    exit 1
}
echo "✅ Migration status check successful"

# Test migration upgrade
echo "🔄 Testing migration upgrade..."
docker-compose run --rm app python -m flask db upgrade || {
    echo "❌ Failed to upgrade database"
    exit 1
}
echo "✅ Migration upgrade successful"

# Test database schema
echo "🏗️  Testing database schema..."
tables=$(docker-compose exec -T db psql -U cognition_user -d cognition_curator_dev -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';" | grep -v "alembic_version" | wc -l)
if [ "$tables" -lt 5 ]; then
    echo "❌ Error: Expected at least 5 tables, found $tables"
    exit 1
fi
echo "✅ Database schema looks good ($tables tables found)"

# Test creating a new test migration
echo "🆕 Testing migration creation..."
test_message="test_migration_$(date +%s)"
docker-compose run --rm app python -m flask db migrate -m "$test_message" > /dev/null 2>&1 || {
    echo "❌ Failed to create test migration"
    exit 1
}

# Find and remove the test migration file
test_file=$(find migrations/versions/ -name "*${test_message}*" | head -1)
if [ -n "$test_file" ]; then
    rm "$test_file"
    echo "✅ Migration creation test successful (test file removed)"
else
    echo "⚠️  Migration creation test completed (no new migration file found - this is normal if no changes detected)"
fi

# Test schema dump
echo "📋 Testing schema dump..."
docker-compose exec -T db pg_dump -U cognition_user -d cognition_curator_dev --schema-only --no-owner --no-privileges > test_schema.sql
schema_size=$(wc -l < test_schema.sql)
if [ "$schema_size" -lt 100 ]; then
    echo "❌ Error: Schema dump seems too small ($schema_size lines)"
    rm test_schema.sql
    exit 1
fi
rm test_schema.sql
echo "✅ Schema dump test successful ($schema_size lines)"

# Clean up
echo "🧹 Cleaning up..."
docker-compose down

echo ""
echo "🎉 All migration tests passed!"
echo ""
echo "📋 Summary:"
echo "   ✅ Database connection working"
echo "   ✅ Migration system initialized"
echo "   ✅ Migration commands functional"
echo "   ✅ Database schema created correctly"
echo "   ✅ Migration creation working"
echo "   ✅ Schema dump working"
echo ""
echo "🚀 Your migration setup is ready for Railway deployment!"
