# Railway Database Migration Guide

This guide explains how to manage database migrations for the Cognition Curator application on Railway.

## Overview

The application uses Flask-Migrate (Alembic) for database schema management. This provides version control for your database schema and enables safe, incremental updates to production.

## File Structure

```
server/
├── migrations/                     # Migration files directory
│   ├── versions/                  # Individual migration files
│   │   └── 28a8c0e6e895_initial_migration.py
│   ├── alembic.ini               # Alembic configuration
│   └── env.py                    # Migration environment setup
├── scripts/deploy/
│   ├── railway_init.sh           # Railway deployment initialization
│   └── railway_migration_guide.md # This guide
└── railway_schema.sql            # Complete schema dump for reference
```

## Railway Deployment Configuration

### Environment Variables Required

Ensure these environment variables are set in your Railway project:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
FLASK_ENV=production
RAILWAY_ENVIRONMENT=production
```

### Build Command

Set your Railway build command to:

```bash
pip install -r requirements.txt
```

### Start Command

Set your Railway start command to:

```bash
chmod +x scripts/deploy/railway_init.sh && ./scripts/deploy/railway_init.sh && python -m flask run --host=0.0.0.0 --port=$PORT
```

## Migration Workflow

### 1. Development Workflow

When developing locally:

```bash
# Start local database
docker-compose up -d db

# Make model changes in src/models/

# Create a new migration
python -m flask db migrate -m "Description of changes"

# Review the generated migration file in migrations/versions/

# Apply migration locally
python -m flask db upgrade

# Test your changes thoroughly
```

### 2. Production Deployment

Railway will automatically:

1. **Build Phase**: Install dependencies
2. **Deploy Phase**:
   - Run `railway_init.sh` script
   - Check database connectivity
   - Create required extensions
   - Run `flask db upgrade` to apply migrations
   - Start the application

### 3. Manual Migration Management

If you need to run migrations manually on Railway:

```bash
# Connect to Railway environment
railway shell

# Check current migration status
python -m flask db current

# See migration history
python -m flask db history

# Upgrade to latest
python -m flask db upgrade

# Downgrade (use with caution!)
python -m flask db downgrade
```

## Common Migration Scenarios

### Adding New Tables

1. Add new model to `src/models/`
2. Import the model in `src/models/__init__.py`
3. Create migration:
   ```bash
   python -m flask db migrate -m "Add new table"
   ```

### Adding Columns

1. Add column to existing model
2. Create migration:
   ```bash
   python -m flask db migrate -m "Add column to table"
   ```

### Modifying Columns

1. Update model definition
2. Create migration:
   ```bash
   python -m flask db migrate -m "Modify column type"
   ```
3. **Important**: Review the generated migration for data safety

### Renaming Columns/Tables

```python
# In migration file, use op.alter_column or op.rename_table
def upgrade():
    op.alter_column('users', 'old_name', new_column_name='new_name')
```

## Best Practices

### Migration Safety

1. **Always review generated migrations** before applying
2. **Test migrations on a copy of production data** when possible
3. **Backup database** before major schema changes
4. **Write both upgrade and downgrade** functions
5. **Make migrations reversible** when possible

### Migration File Guidelines

1. **Use descriptive names**: `add_user_preferences_table`
2. **Keep migrations atomic**: One logical change per migration
3. **Test with real data**: Don't just test with empty tables
4. **Document complex changes**: Add comments for unusual operations

### Railway-Specific Considerations

1. **Zero-downtime deployments**: Structure migrations to avoid breaking existing code
2. **Connection limits**: Railway has connection limits, ensure migrations don't hold connections too long
3. **Timeout limits**: Large migrations may timeout, consider breaking them up
4. **Environment consistency**: Ensure development and production schemas stay in sync

## Troubleshooting

### Migration Fails on Railway

1. Check Railway logs for specific error messages
2. Verify all environment variables are set correctly
3. Ensure migration is compatible with PostgreSQL version on Railway
4. Check for connection timeouts or limits

### Schema Drift

If development and production schemas get out of sync:

1. Create a fresh database from production dump
2. Generate new migration against current production state
3. Test migration thoroughly before deploying

### Rollback Scenarios

```bash
# Rollback to specific migration
python -m flask db downgrade <revision_id>

# Rollback one migration
python -m flask db downgrade -1
```

### Database Recovery

If you need to restore from schema dump:

```bash
# On Railway shell
psql $DATABASE_URL < railway_schema.sql
```

## Monitoring

### Check Migration Status

```bash
# Current migration version
python -m flask db current

# Migration history
python -m flask db history

# Show specific migration details
python -m flask db show <revision_id>
```

### Performance Monitoring

- Monitor migration execution time in Railway logs
- Watch for connection pool exhaustion during migrations
- Monitor application startup time after migrations

## Emergency Procedures

### If Migration Breaks Production

1. **Immediate rollback**:

   ```bash
   railway shell
   python -m flask db downgrade
   ```

2. **Fix and redeploy**:

   - Fix migration locally
   - Test thoroughly
   - Deploy fix

3. **If rollback not possible**:
   - Connect to Railway database directly
   - Manually fix schema issues
   - Update migration state if needed

### Schema Corruption

1. **Export data**:

   ```bash
   pg_dump $DATABASE_URL --data-only > data_backup.sql
   ```

2. **Restore from schema**:

   ```bash
   psql $DATABASE_URL < railway_schema.sql
   ```

3. **Import data**:
   ```bash
   psql $DATABASE_URL < data_backup.sql
   ```

## Development Tips

### Testing Migrations

```bash
# Test upgrade
python -m flask db upgrade

# Test downgrade
python -m flask db downgrade -1

# Test upgrade again
python -m flask db upgrade
```

### Migration Review Checklist

- [ ] Migration is reversible
- [ ] Column constraints are appropriate
- [ ] Indexes are properly defined
- [ ] Foreign keys maintain referential integrity
- [ ] Migration handles existing data correctly
- [ ] Performance impact is acceptable
- [ ] Migration is tested with real data

## Resources

- [Flask-Migrate Documentation](https://flask-migrate.readthedocs.io/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [Railway Documentation](https://docs.railway.app/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
