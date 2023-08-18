'use strict';

import mapValues from 'lodash/mapValues';
import { generateEnumName } from '../../utils/format.js';
import { EMPTY_OBJECT } from '../../utils/object.js';
import { defaultValueSchemable } from '../../utils/query-builder-utils';
import { generateIndexName } from '../../utils/string';
import { ENUM } from './data-types';
import { quoteIdentifier } from '../../utils/dialect';
import { rejectInvalidOptions } from '../../utils/check';
import {
  CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS,
  CREATE_SCHEMA_QUERY_SUPPORTABLE_OPTIONS,
  CREATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
  DROP_TABLE_QUERY_SUPPORTABLE_OPTIONS,
} from '../abstract/query-generator';
import each from 'lodash/each';
import isEmpty from 'lodash/isEmpty';
import isPlainObject from 'lodash/isPlainObject';
import map from 'lodash/map';
import reduce from 'lodash/reduce';

const DataTypes = require('../../data-types');
const { PostgresQueryGeneratorTypeScript } = require('./query-generator-typescript');

/**
 * list of reserved words in PostgreSQL 10
 * source: https://www.postgresql.org/docs/10/static/sql-keywords-appendix.html
 *
 * @private
 */
const POSTGRES_RESERVED_WORDS = 'all,analyse,analyze,and,any,array,as,asc,asymmetric,authorization,binary,both,case,cast,check,collate,collation,column,concurrently,constraint,create,cross,current_catalog,current_date,current_role,current_schema,current_time,current_timestamp,current_user,default,deferrable,desc,distinct,do,else,end,except,false,fetch,for,foreign,freeze,from,full,grant,group,having,ilike,in,initially,inner,intersect,into,is,isnull,join,lateral,leading,left,like,limit,localtime,localtimestamp,natural,not,notnull,null,offset,on,only,or,order,outer,overlaps,placing,primary,references,returning,right,select,session_user,similar,some,symmetric,table,tablesample,then,to,trailing,true,union,unique,user,using,variadic,verbose,when,where,window,with'.split(',');

const CREATE_DATABASE_QUERY_SUPPORTED_OPTIONS = new Set(['encoding', 'collate', 'ctype', 'template']);
const CREATE_SCHEMA_QUERY_SUPPORTED_OPTIONS = new Set();
const CREATE_TABLE_QUERY_SUPPORTED_OPTIONS = new Set(['comment', 'uniqueKeys']);
const DROP_TABLE_QUERY_SUPPORTED_OPTIONS = new Set(['cascade']);

export class PostgresQueryGenerator extends PostgresQueryGeneratorTypeScript {
  setSearchPath(searchPath) {
    return `SET search_path to ${searchPath};`;
  }

  createDatabaseQuery(databaseName, options) {
    if (options) {
      rejectInvalidOptions(
        'createDatabaseQuery',
        this.dialect.name,
        CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS,
        CREATE_DATABASE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    const quotedDatabaseName = this.quoteIdentifier(databaseName);
    const encoding = options?.encoding ? ` ENCODING = ${this.escape(options.encoding)}` : '';
    const collation = options?.collate ? ` LC_COLLATE = ${this.escape(options.collate)}` : '';
    const ctype = options?.ctype ? ` LC_CTYPE = ${this.escape(options.ctype)}` : '';
    const template = options?.template ? ` TEMPLATE = ${this.escape(options.template)}` : '';

    return `CREATE DATABASE ${quotedDatabaseName}${encoding}${collation}${ctype}${template};`;
  }

  dropDatabaseQuery(databaseName) {
    return `DROP DATABASE IF EXISTS ${this.quoteIdentifier(databaseName)};`;
  }

  listDatabasesQuery() {
    return `SELECT datname AS name FROM pg_database;`;
  }

  createSchemaQuery(schema, options) {
    if (options) {
      rejectInvalidOptions(
        'createSchemaQuery',
        this.dialect.name,
        CREATE_SCHEMA_QUERY_SUPPORTABLE_OPTIONS,
        CREATE_SCHEMA_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    return `CREATE SCHEMA IF NOT EXISTS ${this.quoteIdentifier(schema)};`;
  }

  dropSchemaQuery(schema) {
    return `DROP SCHEMA IF EXISTS ${this.quoteIdentifier(schema)} CASCADE;`;
  }

  listSchemasQuery(options) {
    const schemasToSkip = ['information_schema', 'public'];
    if (options?.skip) {
      schemasToSkip.push(...options.skip);
    }

    return `SELECT schema_name FROM information_schema.schemata WHERE schema_name !~ E'^pg_' AND schema_name NOT IN (${schemasToSkip.map(schema => this.escape(schema)).join(', ')});`;
  }

  createTableQuery(tableName, attributes, options) {
    if (options) {
      rejectInvalidOptions(
        'createTableQuery',
        this.dialect.name,
        CREATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        CREATE_TABLE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    options = { ...options };

    const attrStr = [];
    let comments = '';
    let columnComments = '';

    const quotedTable = this.quoteTable(tableName);

    if (options.comment && typeof options.comment === 'string') {
      comments += `; COMMENT ON TABLE ${quotedTable} IS ${this.escape(options.comment)}`;
    }

    for (const attr in attributes) {
      const quotedAttr = this.quoteIdentifier(attr);
      const i = attributes[attr].indexOf('COMMENT ');
      if (i !== -1) {
        // Move comment to a separate query
        const escapedCommentText = this.escape(attributes[attr].slice(Math.max(0, i + 8)));
        columnComments += `; COMMENT ON COLUMN ${quotedTable}.${quotedAttr} IS ${escapedCommentText}`;
        attributes[attr] = attributes[attr].slice(0, Math.max(0, i));
      }

      const dataType = this.dataTypeMapping(tableName, attr, attributes[attr]);
      attrStr.push(`${quotedAttr} ${dataType}`);
    }

    let attributesClause = attrStr.join(', ');

    if (options.uniqueKeys) {
      each(options.uniqueKeys, (index, indexName) => {
        if (typeof indexName !== 'string') {
          indexName = generateIndexName(tableName, index);
        }

        attributesClause += `, CONSTRAINT ${
          this.quoteIdentifier(indexName)
        } UNIQUE (${
          index.fields.map(field => this.quoteIdentifier(field))
            .join(', ')
        })`;
      });
    }

    const pks = reduce(attributes, (acc, attribute, key) => {
      if (attribute.includes('PRIMARY KEY')) {
        acc.push(this.quoteIdentifier(key));
      }

      return acc;
    }, []).join(', ');

    if (pks.length > 0) {
      attributesClause += `, PRIMARY KEY (${pks})`;
    }

    return `CREATE TABLE IF NOT EXISTS ${quotedTable} (${attributesClause})${comments}${columnComments};`;
  }

  dropTableQuery(tableName, options) {
    if (options) {
      rejectInvalidOptions(
        'dropTableQuery',
        this.dialect.name,
        DROP_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        DROP_TABLE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    return `DROP TABLE IF EXISTS ${this.quoteTable(tableName)}${options?.cascade ? ' CASCADE' : ''};`;
  }

  showTablesQuery() {
    const schema = this.options.schema || 'public';

    return `SELECT table_name FROM information_schema.tables WHERE table_schema = ${this.escape(schema)} AND table_type LIKE '%TABLE' AND table_name != 'spatial_ref_sys';`;
  }

  addColumnQuery(table, key, attribute, options) {
    options = options || {};

    const dbDataType = this.attributeToSQL(attribute, { context: 'addColumn', table, key });
    const dataType = attribute.type || attribute;
    const definition = this.dataTypeMapping(table, key, dbDataType);
    const quotedKey = this.quoteIdentifier(key);
    const quotedTable = this.quoteTable(table);
    const ifNotExists = options.ifNotExists ? ' IF NOT EXISTS' : '';

    let query = `ALTER TABLE ${quotedTable} ADD COLUMN ${ifNotExists} ${quotedKey} ${definition};`;

    if (dataType instanceof DataTypes.ENUM) {
      query = this.createEnumQuery(table, key, dataType) + query;
    } else if (dataType instanceof DataTypes.ARRAY && dataType.options.type instanceof DataTypes.ENUM) {
      query = this.createEnumQuery(table, key, dataType.options.type) + query;
    }

    return query;
  }

  removeColumnQuery(tableName, attributeName, options) {
    options = options || {};

    const quotedTableName = this.quoteTable(tableName);
    const quotedAttributeName = this.quoteIdentifier(attributeName);
    const ifExists = options.ifExists ? ' IF EXISTS' : '';

    return `ALTER TABLE ${quotedTableName} DROP COLUMN ${ifExists} ${quotedAttributeName};`;
  }

  attributeTypeToSql(attribute) {
    if (
      attribute.type instanceof DataTypes.ENUM
      || attribute.type instanceof DataTypes.ARRAY && attribute.type.type instanceof DataTypes.ENUM
    ) {
      const enumType = attribute.type.type || attribute.type;
      const values = enumType.options.values;

      if (!Array.isArray(values) || values.length <= 0) {
        throw new Error('Values for ENUM haven\'t been defined.');
      }

      let type = `ENUM(${values.map(value => this.escape(value)).join(', ')})`;

      if (attribute.type instanceof DataTypes.ARRAY) {
        type += '[]';
      }

      return type;
    }

    return attribute.type.toString();
  }

  attributeToSQL(attribute, options) {
    if (!isPlainObject(attribute)) {
      attribute = {
        type: attribute,
      };
    }

    let sql = this.attributeTypeToSql(attribute);

    if (attribute.allowNull === false) {
      sql += ' NOT NULL';
    }

    if (attribute.autoIncrement) {
      if (attribute.autoIncrementIdentity) {
        sql += ' GENERATED BY DEFAULT AS IDENTITY';
      } else {
        sql += ' SERIAL';
      }
    }

    if (defaultValueSchemable(attribute.defaultValue)) {
      sql += ` DEFAULT ${this.escape(attribute.defaultValue, { type: attribute.type })}`;
    }

    if (attribute.unique === true) {
      sql += ' UNIQUE';
    }

    if (attribute.primaryKey) {
      sql += ' PRIMARY KEY';
    }

    if (attribute.references) {
      let schema;

      if (options.schema) {
        schema = options.schema;
      } else if (
        (!attribute.references.table || typeof attribute.references.table === 'string')
        && options.table
        && options.table.schema
      ) {
        schema = options.table.schema;
      }

      const referencesTable = this.extractTableDetails(attribute.references.table, { schema });

      let referencesKey;

      if (!options.withoutForeignKeyConstraints) {
        if (attribute.references.key) {
          referencesKey = this.quoteIdentifiers(attribute.references.key);
        } else {
          referencesKey = this.quoteIdentifier('id');
        }

        sql += ` REFERENCES ${this.quoteTable(referencesTable)} (${referencesKey})`;

        if (attribute.onDelete) {
          sql += ` ON DELETE ${attribute.onDelete.toUpperCase()}`;
        }

        if (attribute.onUpdate) {
          sql += ` ON UPDATE ${attribute.onUpdate.toUpperCase()}`;
        }

        if (attribute.references.deferrable) {
          sql += ` ${this._getDeferrableConstraintSnippet(attribute.references.deferrable)}`;
        }
      }
    }

    if (attribute.comment && typeof attribute.comment === 'string') {
      if (options && ['addColumn', 'changeColumn'].includes(options.context)) {
        const quotedAttr = this.quoteIdentifier(options.key);
        const escapedCommentText = this.escape(attribute.comment);
        sql += `; COMMENT ON COLUMN ${this.quoteTable(options.table)}.${quotedAttr} IS ${escapedCommentText}`;
      } else {
        // for createTable event which does it's own parsing
        // TODO: centralize creation of comment statements here
        sql += ` COMMENT ${attribute.comment}`;
      }
    }

    return sql;
  }

  attributesToSQL(attributes, options) {
    const result = {};

    for (const key in attributes) {
      const attribute = attributes[key];
      result[attribute.field || key] = this.attributeToSQL(attribute, { key, ...options });
    }

    return result;
  }

  renameColumnQuery(tableName, attrBefore, attributes) {

    const attrString = [];

    for (const attributeName in attributes) {
      attrString.push(`${this.quoteIdentifier(attrBefore)} TO ${this.quoteIdentifier(attributeName)}`);
    }

    return `ALTER TABLE ${this.quoteTable(tableName)} RENAME COLUMN ${attrString.join(', ')};`;
  }

  fn(fnName, tableName, parameters, body, returns, language) {
    fnName = fnName || 'testfunc';
    language = language || 'plpgsql';
    returns = returns ? `RETURNS ${returns}` : '';
    parameters = parameters || '';

    return `CREATE OR REPLACE FUNCTION pg_temp.${fnName}(${parameters}) ${returns} AS $func$ BEGIN ${body} END; $func$ LANGUAGE ${language}; SELECT * FROM pg_temp.${fnName}();`;
  }

  truncateTableQuery(tableName, options = {}) {
    return [
      `TRUNCATE ${this.quoteTable(tableName)}`,
      options.restartIdentity ? ' RESTART IDENTITY' : '',
      options.cascade ? ' CASCADE' : '',
    ].join('');
  }

  deleteQuery(tableName, where, options = EMPTY_OBJECT, model) {
    const table = this.quoteTable(tableName);

    const escapeOptions = {
      replacements: options.replacements,
      model,
    };

    const limit = options.limit ? ` LIMIT ${this.escape(options.limit, escapeOptions)}` : '';
    let primaryKeys = '';
    let primaryKeysSelection = '';

    let whereClause = this.whereQuery(where, { ...options, model });
    if (whereClause) {
      whereClause = ` ${whereClause}`;
    }

    if (options.limit) {
      if (!model) {
        throw new Error('Cannot LIMIT delete without a model.');
      }

      const pks = Object.values(model.primaryKeys).map(pk => this.quoteIdentifier(pk.field)).join(',');

      primaryKeys = model.primaryKeyAttributes.length > 1 ? `(${pks})` : pks;
      primaryKeysSelection = pks;

      return `DELETE FROM ${table} WHERE ${primaryKeys} IN (SELECT ${primaryKeysSelection} FROM ${table}${whereClause}${limit})`;
    }

    return `DELETE FROM ${table}${whereClause}`;
  }

  addLimitAndOffset(options) {
    let fragment = '';
    if (options.limit != null) {
      fragment += ` LIMIT ${this.escape(options.limit, options)}`;
    }

    if (options.offset) {
      fragment += ` OFFSET ${this.escape(options.offset, options)}`;
    }

    return fragment;
  }

  createTrigger(tableName, triggerName, eventType, fireOnSpec, functionName, functionParams, optionsArray) {
    const decodedEventType = this.decodeTriggerEventType(eventType);
    const eventSpec = this.expandTriggerEventSpec(fireOnSpec);
    const expandedOptions = this.expandOptions(optionsArray);
    const paramList = this._expandFunctionParamList(functionParams);

    return `CREATE ${this.triggerEventTypeIsConstraint(eventType)}TRIGGER ${this.quoteIdentifier(triggerName)} ${decodedEventType} ${
      eventSpec} ON ${this.quoteTable(tableName)}${expandedOptions ? ` ${expandedOptions}` : ''} EXECUTE PROCEDURE ${functionName}(${paramList});`;
  }

  dropTrigger(tableName, triggerName) {
    return `DROP TRIGGER ${this.quoteIdentifier(triggerName)} ON ${this.quoteTable(tableName)} RESTRICT;`;
  }

  renameTrigger(tableName, oldTriggerName, newTriggerName) {
    return `ALTER TRIGGER ${this.quoteIdentifier(oldTriggerName)} ON ${this.quoteTable(tableName)} RENAME TO ${this.quoteIdentifier(newTriggerName)};`;
  }

  createFunction(functionName, params, returnType, language, body, optionsArray, options) {
    if (!functionName || !returnType || !language || !body) {
      throw new Error('createFunction missing some parameters. Did you pass functionName, returnType, language and body?');
    }

    const paramList = this._expandFunctionParamList(params);
    const variableList = options && options.variables ? this._expandFunctionVariableList(options.variables) : '';
    const expandedOptionsArray = this.expandOptions(optionsArray);

    const statement = options && options.force ? 'CREATE OR REPLACE FUNCTION' : 'CREATE FUNCTION';

    return `${statement} ${functionName}(${paramList}) RETURNS ${returnType} AS $func$ ${variableList} BEGIN ${body} END; $func$ language '${language}'${expandedOptionsArray};`;
  }

  dropFunction(functionName, params) {
    if (!functionName) {
      throw new Error('requires functionName');
    }

    // RESTRICT is (currently, as of 9.2) default but we'll be explicit
    const paramList = this._expandFunctionParamList(params);

    return `DROP FUNCTION ${functionName}(${paramList}) RESTRICT;`;
  }

  renameFunction(oldFunctionName, params, newFunctionName) {
    const paramList = this._expandFunctionParamList(params);

    return `ALTER FUNCTION ${oldFunctionName}(${paramList}) RENAME TO ${newFunctionName};`;
  }

  _expandFunctionParamList(params) {
    if (params === undefined || !Array.isArray(params)) {
      throw new Error('_expandFunctionParamList: function parameters array required, including an empty one for no arguments');
    }

    const paramList = [];
    for (const curParam of params) {
      const paramDef = [];
      if (curParam.type) {
        if (curParam.direction) {
          paramDef.push(curParam.direction);
        }

        if (curParam.name) {
          paramDef.push(curParam.name);
        }

        paramDef.push(curParam.type);
      } else {
        throw new Error('function or trigger used with a parameter without any type');
      }

      const joined = paramDef.join(' ');
      if (joined) {
        paramList.push(joined);
      }

    }

    return paramList.join(', ');
  }

  _expandFunctionVariableList(variables) {
    if (!Array.isArray(variables)) {
      throw new TypeError('_expandFunctionVariableList: function variables must be an array');
    }

    const variableDefinitions = [];
    for (const variable of variables) {
      if (!variable.name || !variable.type) {
        throw new Error('function variable must have a name and type');
      }

      let variableDefinition = `DECLARE ${variable.name} ${variable.type}`;
      if (variable.default) {
        variableDefinition += ` := ${variable.default}`;
      }

      variableDefinition += ';';
      variableDefinitions.push(variableDefinition);
    }

    return variableDefinitions.join(' ');
  }

  expandOptions(options) {
    return options === undefined || isEmpty(options)
      ? '' : options.join(' ');
  }

  decodeTriggerEventType(eventSpecifier) {
    const EVENT_DECODER = {
      after: 'AFTER',
      before: 'BEFORE',
      instead_of: 'INSTEAD OF',
      after_constraint: 'AFTER',
    };

    if (!EVENT_DECODER[eventSpecifier]) {
      throw new Error(`Invalid trigger event specified: ${eventSpecifier}`);
    }

    return EVENT_DECODER[eventSpecifier];
  }

  triggerEventTypeIsConstraint(eventSpecifier) {
    return eventSpecifier === 'after_constraint' ? 'CONSTRAINT ' : '';
  }

  expandTriggerEventSpec(fireOnSpec) {
    if (isEmpty(fireOnSpec)) {
      throw new Error('no table change events specified to trigger on');
    }

    return map(fireOnSpec, (fireValue, fireKey) => {
      const EVENT_MAP = {
        insert: 'INSERT',
        update: 'UPDATE',
        delete: 'DELETE',
        truncate: 'TRUNCATE',
      };

      if (!EVENT_MAP[fireValue]) {
        throw new Error(`parseTriggerEventSpec: undefined trigger event ${fireKey}`);
      }

      let eventSpec = EVENT_MAP[fireValue];
      if (eventSpec === 'UPDATE' && Array.isArray(fireValue) && fireValue.length > 0) {
        eventSpec += ` OF ${fireValue.join(', ')}`;
      }

      return eventSpec;
    }).join(' OR ');
  }

  fromArray(text) {
    if (Array.isArray(text)) {
      return text;
    }

    text = text.replace(/^{/, '').replace(/}$/, '');
    let matches = text.match(/("(?:\\.|[^"\\])*"|[^,]*)(?:\s*,\s*|\s*$)/gi);

    if (matches.length === 0) {
      return [];
    }

    matches = matches.map(m => m.replace(/",$/, '').replace(/,$/, '').replaceAll(/(^"|"$)/g, ''));

    return matches.slice(0, -1);
  }

  dataTypeMapping(tableName, attr, dataType) {
    if (dataType.includes('PRIMARY KEY')) {
      dataType = dataType.replace('PRIMARY KEY', '');
    }

    if (dataType.includes('SERIAL')) {
      if (dataType.includes('BIGINT')) {
        dataType = dataType.replace('SERIAL', 'BIGSERIAL');
        dataType = dataType.replace('BIGINT', '');
      } else if (dataType.includes('SMALLINT')) {
        dataType = dataType.replace('SERIAL', 'SMALLSERIAL');
        dataType = dataType.replace('SMALLINT', '');
      } else {
        dataType = dataType.replace('INTEGER', '');
      }

      dataType = dataType.replace('NOT NULL', '');
    }

    if (dataType.startsWith('ENUM(')) {
      dataType = dataType.replace(/^ENUM\(.+\)/, this.pgEnumName(tableName, attr));
    }

    return dataType;
  }

  /**
   * Generate common SQL prefix for getForeignKeyReferencesQuery.
   *
   * @returns {string}
   */
  _getForeignKeyReferencesQueryPrefix() {
    return 'SELECT '
      + 'DISTINCT tc.constraint_name as constraint_name, '
      + 'tc.constraint_schema as constraint_schema, '
      + 'tc.constraint_catalog as constraint_catalog, '
      + 'tc.table_name as table_name,'
      + 'tc.table_schema as table_schema,'
      + 'tc.table_catalog as table_catalog,'
      + 'tc.initially_deferred as initially_deferred,'
      + 'tc.is_deferrable as is_deferrable,'
      + 'kcu.column_name as column_name,'
      + 'ccu.table_schema  AS referenced_table_schema,'
      + 'ccu.table_catalog  AS referenced_table_catalog,'
      + 'ccu.table_name  AS referenced_table_name,'
      + 'ccu.column_name AS referenced_column_name '
      + 'FROM information_schema.table_constraints AS tc '
      + 'JOIN information_schema.key_column_usage AS kcu '
      + 'ON tc.constraint_name = kcu.constraint_name '
      + 'JOIN information_schema.constraint_column_usage AS ccu '
      + 'ON ccu.constraint_name = tc.constraint_name ';
  }

  /**
   * Generates an SQL query that returns all foreign keys details of a table.
   *
   * As for getForeignKeyQuery is not compatible with getForeignKeyReferencesQuery, so add a new function.
   *
   * @param {string} tableName
   * @param {string} catalogName
   * @param {string} schemaName
   */
  getForeignKeyReferencesQuery(tableName, catalogName, schemaName) {
    return `${this._getForeignKeyReferencesQueryPrefix()
    }WHERE constraint_type = 'FOREIGN KEY' AND tc.table_name = '${tableName}'${
      catalogName ? ` AND tc.table_catalog = '${catalogName}'` : ''
    }${schemaName ? ` AND tc.table_schema = '${schemaName}'` : ''}`;
  }

  getForeignKeyReferenceQuery(table, columnName) {
    const tableName = table.tableName || table;
    const schema = table.schema;

    return `${this._getForeignKeyReferencesQueryPrefix()
    }WHERE constraint_type = 'FOREIGN KEY' AND tc.table_name='${tableName}' AND  kcu.column_name = '${columnName}'${
      schema ? ` AND tc.table_schema = '${schema}'` : ''}`;
  }

  /**
   * Generates an SQL query that removes a foreign key from a table.
   *
   * @param  {string} tableName  The name of the table.
   * @param  {string} foreignKey The name of the foreign key constraint.
   * @returns {string}            The generated sql query.
   * @private
   */
  dropForeignKeyQuery(tableName, foreignKey) {
    return `ALTER TABLE ${this.quoteTable(tableName)} DROP CONSTRAINT ${this.quoteIdentifier(foreignKey)};`;
  }

  /**
   * Quote identifier in sql clause
   *
   * @param {string} identifier
   * @param {boolean} force
   *
   * @returns {string}
   */
  quoteIdentifier(identifier, force) {
    const optForceQuote = force || false;
    // TODO [>7]: remove "quoteIdentifiers: false" option
    const optQuoteIdentifiers = this.options.quoteIdentifiers !== false;

    if (
      optForceQuote === true
      // TODO [>7]: drop this.options.quoteIdentifiers. Always quote identifiers based on these rules
      || optQuoteIdentifiers !== false
      || identifier.includes('.')
      || identifier.includes('->')
      || POSTGRES_RESERVED_WORDS.includes(identifier.toLowerCase())
    ) {
      // In Postgres if tables or attributes are created double-quoted,
      // they are also case sensitive. If they contain any uppercase
      // characters, they must always be double-quoted. This makes it
      // impossible to write queries in portable SQL if tables are created in
      // this way. Hence, we strip quotes if we don't want case sensitivity.
      return quoteIdentifier(identifier, this.dialect.TICK_CHAR_LEFT, this.dialect.TICK_CHAR_RIGHT);
    }

    return identifier;
  }
}
