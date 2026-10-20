#!/bin/sh
# Runs once when the local PostgreSQL volume is first created.
# Role names are fixed because the security migration grants to them by name.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
create extension if not exists vector;
create role higgsden_app login password '${APP_DB_PASSWORD}' nobypassrls;
create role higgsden_operator login password '${OPERATOR_DB_PASSWORD}' nobypassrls;
grant connect on database ${POSTGRES_DB} to higgsden_app, higgsden_operator;
SQL
