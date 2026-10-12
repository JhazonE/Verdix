import dotenv from 'dotenv';
dotenv.config();

// The password is deliberately reported only as present/absent: this script is
// run from a terminal and its output ends up in scrollback, CI logs and
// screenshots. Knowing whether .env was picked up is the only thing the echo
// was ever for, and that does not require printing the secret.
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '(set)' : '(not set)');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);

import { query } from '../lib/mysql';

async function createTables() {
  try {
    // Create database if it doesn't exist
    await query('CREATE DATABASE IF NOT EXISTS verdix');

    // Use the database
    await query('USE verdix');

    // Create products table
    const createProductsTable = `
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        additional_description TEXT,
        category VARCHAR(100),
        brand VARCHAR(100),
        subcategory VARCHAR(100),
        stock INT DEFAULT 0,
        reorder_point INT DEFAULT 0,
        avg_daily_sales DECIMAL(10,2) DEFAULT 0,
        price DECIMAL(10,2) NOT NULL,
        cost DECIMAL(10,2),
        sku VARCHAR(100) UNIQUE,
        barcode VARCHAR(100),
        image_url VARCHAR(500),
        image_hint VARCHAR(255),
        is_serialized BOOLEAN DEFAULT FALSE,
        unit_of_measure VARCHAR(50),
        parent_id VARCHAR(50),
        conversion_factor DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES products(id)
      )
    `;

    await query(createProductsTable);
    console.log('✅ Products table created successfully');

    // Create brands table
    const createBrandsTable = `
      CREATE TABLE IF NOT EXISTS brands (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createBrandsTable);
    console.log('✅ Brands table created successfully');

    // Create categories table
    const createCategoriesTable = `
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createCategoriesTable);
    console.log('✅ Categories table created successfully');

    // Create subcategories table
    const createSubcategoriesTable = `
      CREATE TABLE IF NOT EXISTS subcategories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createSubcategoriesTable);
    console.log('✅ Subcategories table created successfully');

    // Create units of measure table
    const createUnitsTable = `
      CREATE TABLE IF NOT EXISTS units_of_measure (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        abbreviation VARCHAR(10),
        conversion_factor DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createUnitsTable);
    console.log('✅ Units of measure table created successfully');

    // Create users table
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        uid VARCHAR(50) PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255),
        user_type VARCHAR(50) DEFAULT 'User',
        display_name VARCHAR(255),
        photo_url VARCHAR(500),
        disabled BOOLEAN DEFAULT FALSE,
        creation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createUsersTable);
    console.log('✅ Users table created successfully');

    // Create user_permissions table
    const createUserPermissionsTable = `
      CREATE TABLE IF NOT EXISTS user_permissions (
        id VARCHAR(50) PRIMARY KEY,
        user_uid VARCHAR(50),
        permission VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `;

    await query(createUserPermissionsTable);
    console.log('✅ User permissions table created successfully');

    console.log('🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Error setting up database:', error);
    throw error;
  }
}

createTables()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
