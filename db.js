const { Pool } = require('pg');

// Configuramos la conexión a tu base de datos local
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'sistema_negocio',
    password: '1234', // Cambia esto por la contraseña que creamos antes
    port: 5432,
});

// Verificamos si hay errores en la conexión
pool.on('error', (err, client) => {
    console.error('Error inesperado en la base de datos', err);
    process.exit(-1);
});

module.exports = pool;