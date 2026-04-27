const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Clave secreta para los Tokens de sesión
const SECRET_KEY = 'll_burgers_super_secreta_2026';

// Conexión a la base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'sistema_negocio',
    password: '1234',
    port: 5432,
});

// ==========================================
// 1. AUTENTICACIÓN Y SEGURIDAD
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userResult = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });

        const usuario = userResult.rows[0];
        const passwordCorrecta = (password === 'admin123' && usuario.username === 'lendy_admin');

        if (!passwordCorrecta) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const token = jwt.sign({ id: usuario.id, username: usuario.username, rol: usuario.rol }, SECRET_KEY, { expiresIn: '8h' });
        res.json({ mensaje: 'Bienvenido', token, usuario: { username: usuario.username, rol: usuario.rol } });
    } catch (err) {
        res.status(500).send('Error en login');
    }
});

// ==========================================
// 2. TASAS DE CAMBIO
// ==========================================
app.post('/api/tasas', async (req, res) => {
    try {
        const { moneda, tasa } = req.body;
        const existe = await pool.query('SELECT id FROM tasas_cambio WHERE moneda = $1', [moneda]);
        if (existe.rows.length > 0) {
            await pool.query('UPDATE tasas_cambio SET tasa = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE moneda = $2', [tasa, moneda]);
        } else {
            await pool.query('INSERT INTO tasas_cambio (moneda, tasa) VALUES ($1, $2)', [moneda, tasa]);
        }
        res.json({ mensaje: 'Tasa actualizada' });
    } catch (err) {
        res.status(500).send('Error actualizando tasa');
    }
});

app.get('/api/tasas', async (req, res) => {
    try {
        const tasas = await pool.query('SELECT * FROM tasas_cambio');
        res.json(tasas.rows);
    } catch (err) {
        res.status(500).send('Error obteniendo tasas');
    }
});

// ==========================================
// 3. INVENTARIO, RECETAS Y COSTOS (Adaptado a COP)
// ==========================================
app.post('/api/insumos', async (req, res) => {
    try {
        const { nombre, unidad_medida, costo_actual, stock_actual } = req.body;
        const nuevoInsumo = await pool.query(
            `INSERT INTO insumos (nombre, unidad_medida, costo_actual, stock_actual) VALUES ($1, $2, $3, $4) RETURNING *`,
            [nombre, unidad_medida, costo_actual, stock_actual]
        );
        res.json({ mensaje: 'Insumo registrado', insumo: nuevoInsumo.rows[0] });
    } catch (err) {
        res.status(500).send('Error al registrar insumo');
    }
});

app.post('/api/recetas', async (req, res) => {
    try {
        const { producto_id, insumo_id, cantidad_necesaria } = req.body;
        const nuevaReceta = await pool.query(
            `INSERT INTO recetas (producto_id, insumo_id, cantidad_necesaria) VALUES ($1, $2, $3) RETURNING *`,
            [producto_id, insumo_id, cantidad_necesaria]
        );
        res.json({ mensaje: 'Ingrediente agregado a la receta', receta: nuevaReceta.rows[0] });
    } catch (err) {
        res.status(500).send('Error al armar la receta');
    }
});

app.get('/api/productos/:id/costo', async (req, res) => {
    try {
        const producto_id = req.params.id;
        const calculo = await pool.query(`
      SELECT 
        p.nombre AS producto,
        p.precio_venta_cop,
        COALESCE(SUM(i.costo_actual * r.cantidad_necesaria), 0) AS costo_produccion_cop,
        (p.precio_venta_cop - COALESCE(SUM(i.costo_actual * r.cantidad_necesaria), 0)) AS ganancia_neta_cop
      FROM productos p
      LEFT JOIN recetas r ON p.id = r.producto_id
      LEFT JOIN insumos i ON r.insumo_id = i.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [producto_id]);
        res.json(calculo.rows[0]);
    } catch (err) {
        res.status(500).send('Error calculando el costo del producto');
    }
});

// ==========================================
// 4. PRODUCTOS Y CATÁLOGO (Adaptado a COP)
// ==========================================
app.get('/api/productos', async (req, res) => {
    try {
        const productos = await pool.query(`
      SELECT p.id, p.nombre AS producto, p.precio_venta_cop, c.id AS categoria_id, c.nombre AS turno 
      FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.id ASC
    `);
        res.json(productos.rows);
    } catch (err) {
        console.error("🔥 ERROR EXACTO DE SQL:", err.message);
        res.status(500).send('Error cargando productos');
    }
});

app.post('/api/productos', async (req, res) => {
    try {
        const { nombre, categoria_id, precio_venta_cop } = req.body;
        await pool.query('INSERT INTO productos (nombre, categoria_id, precio_venta_cop) VALUES ($1, $2, $3)', [nombre, categoria_id, precio_venta_cop]);
        res.json({ mensaje: 'Producto creado' });
    } catch (err) {
        res.status(500).send('Error creando producto');
    }
});

app.put('/api/productos/:id', async (req, res) => {
    try {
        const { nombre, categoria_id, precio_venta_cop } = req.body;
        await pool.query('UPDATE productos SET nombre = $1, categoria_id = $2, precio_venta_cop = $3 WHERE id = $4', [nombre, categoria_id, precio_venta_cop, req.params.id]);
        res.json({ mensaje: 'Producto actualizado' });
    } catch (err) {
        res.status(500).send('Error actualizando producto');
    }
});

app.delete('/api/productos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]);
        res.json({ mensaje: 'Producto eliminado' });
    } catch (err) {
        res.status(500).send('Error eliminando producto');
    }
});

// ==========================================
// 5. CLIENTES Y CHECKOUT POS (Adaptado a COP)
// ==========================================
app.get('/api/clientes/cedula/:cedula', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre, cedula FROM clientes WHERE cedula = $1', [req.params.cedula]);
        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).send('Error buscando cliente');
    }
});

// ======== ESTA ES LA NUEVA RUTA CON FILTRO DE FECHA ========
app.get('/api/dashboard/ventas', async (req, res) => {
    try {
        const { fecha } = req.query;
        // Si no nos mandan fecha, usamos la fecha de hoy por defecto
        const filtroFecha = fecha ? fecha : new Date().toLocaleDateString('en-CA');

        const ventas = await pool.query(`
          SELECT p.id, p.total_cop, p.estado_pago, p.fecha_hora, p.turno, c.nombre, c.cedula,
                 COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE pedido_id = p.id), 0) AS pagado
          FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id
          WHERE DATE(p.fecha_hora) = $1 
          ORDER BY p.fecha_hora DESC
        `, [filtroFecha]);

        res.json(ventas.rows);
    } catch (err) {
        console.error("Error cargando ventas:", err);
        res.status(500).send('Error cargando ventas');
    }
});

app.get('/api/pedidos/abiertos', async (req, res) => {
    try {
        const pedidos = await pool.query(`
      SELECT p.id, c.nombre, p.total_cop 
      FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id 
      WHERE DATE(p.fecha_hora) = CURRENT_DATE AND p.estado_pago != 'Pagado'
    `);
        res.json(pedidos.rows);
    } catch (err) {
        res.status(500).send('Error buscando pedidos');
    }
});

app.post('/api/checkout', async (req, res) => {
    try {
        // 1. Recibimos el "abono" desde React
        const { cedula, nombre, turno, carrito, pedido_id_existente, abono } = req.body;
        let cliente_id = null;

        if (cedula) {
            const clienteRes = await pool.query('SELECT id FROM clientes WHERE cedula = $1', [cedula]);
            if (clienteRes.rows.length > 0) {
                cliente_id = clienteRes.rows[0].id;
            } else if (nombre) {
                const nuevoCli = await pool.query('INSERT INTO clientes (nombre, cedula) VALUES ($1, $2) RETURNING id', [nombre, cedula]);
                cliente_id = nuevoCli.rows[0].id;
            }
        }

        let total_cop_carrito = carrito.reduce((acc, item) => acc + (parseFloat(item.precio_venta_cop) * item.cantidad), 0);

        // 2. CÁLCULO DE LA DEUDA Y EL ABONO
        // Si la caja del abono viene vacía, asumimos que pagó el 100%
        let monto_pagado = (abono !== undefined && abono !== '') ? parseFloat(abono) : total_cop_carrito;
        let deuda_generada = total_cop_carrito - monto_pagado;

        // 3. REGLA DE ORO: No hay fiado para fantasmas
        if (deuda_generada > 0 && !cliente_id) {
            return res.status(400).json({ error: 'Para registrar un fiado, debes ingresar la cédula y el nombre del cliente.' });
        }

        let estado = deuda_generada > 0 ? 'Parcial' : 'Pagado';
        let pedido_id = pedido_id_existente;

        if (pedido_id) {
            await pool.query('UPDATE pedidos SET total_cop = total_cop + $1, estado_pago = $2 WHERE id = $3', [total_cop_carrito, estado, pedido_id]);
        } else {
            const nuevoPed = await pool.query(
                "INSERT INTO pedidos (cliente_id, total_cop, turno, estado_pago) VALUES ($1, $2, $3, $4) RETURNING id",
                [cliente_id, total_cop_carrito, turno, estado]
            );
            pedido_id = nuevoPed.rows[0].id;
        }

        for (let item of carrito) {
            await pool.query(
                'INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario_cop, subtotal_cop) VALUES ($1, $2, $3, $4, $5)',
                [pedido_id, item.id, item.cantidad, item.precio_venta_cop, item.cantidad * item.precio_venta_cop]
            );
        }

        // 4. GUARDAR LA DEUDA AL CLIENTE
        if (deuda_generada > 0 && cliente_id) {
            await pool.query('UPDATE clientes SET deuda_total = COALESCE(deuda_total, 0) + $1 WHERE id = $2', [deuda_generada, cliente_id]);
        }

        // 5. REGISTRAR EL DINERO QUE ENTRÓ A CAJA
        if (monto_pagado > 0) {
            await pool.query('INSERT INTO pagos (pedido_id, monto_pagado, moneda_pago, tasa_aplicada) VALUES ($1, $2, $3, $4)', [pedido_id, monto_pagado, 'COP', 1]);
        }

        res.json({ mensaje: '¡Operación procesada con éxito!', pedido_id });
    } catch (err) {
        console.error("🔥 Error procesando venta:", err);
        res.status(500).json({ error: 'Error interno en el servidor' });
    }
});

// ==========================================
// 6. PAGOS PARCIALES Y CUENTAS POR COBRAR (FIADOS)
// ==========================================
app.post('/api/pedidos/:id/pagos', async (req, res) => {
    try {
        const pedido_id = req.params.id;
        const { monto_pagado, moneda_pago, tasa_aplicada, cliente_id } = req.body;

        const nuevoPago = await pool.query(
            `INSERT INTO pagos (pedido_id, monto_pagado, moneda_pago, tasa_aplicada) VALUES ($1, $2, $3, $4) RETURNING *`,
            [pedido_id, monto_pagado, moneda_pago, tasa_aplicada]
        );

        await pool.query(`UPDATE pedidos SET estado_pago = 'Parcial' WHERE id = $1`, [pedido_id]);

        // Si la base es COP, restamos el equivalente en COP de la deuda
        if (cliente_id) {
            // Suponiendo que el pago entra en pesos, o se convierte a pesos según la tasa_aplicada
            const abono_en_cop = moneda_pago === 'COP' ? monto_pagado : (monto_pagado * tasa_aplicada);
            await pool.query(
                `UPDATE clientes SET deuda_total = deuda_total - $1 WHERE id = $2`,
                [abono_en_cop, cliente_id]
            );
        }

        res.json({ mensaje: 'Pago registrado exitosamente', recibo: nuevoPago.rows[0] });
    } catch (err) {
        res.status(500).send('Error al procesar el pago');
    }
});

// MÓDULO DE COBRANZA 
app.get('/api/clientes/deudores', async (req, res) => {
    try {
        const deudores = await pool.query(`
      SELECT id, nombre, telefono, cedula, deuda_total 
      FROM clientes 
      WHERE deuda_total > 0
      ORDER BY deuda_total DESC
    `);

        res.json({
            total_dinero_en_calle_cop: deudores.rows.reduce((acc, c) => acc + parseFloat(c.deuda_total), 0),
            clientes: deudores.rows
        });
    } catch (err) {
        res.status(500).send('Error consultando deudores');
    }
});

// Cobrar una deuda a un cliente
app.post('/api/clientes/:id/pagar-deuda', async (req, res) => {
    try {
        const { monto_abonado } = req.body;

        // 1. Descontamos el dinero de la deuda del cliente
        await pool.query('UPDATE clientes SET deuda_total = deuda_total - $1 WHERE id = $2', [monto_abonado, req.params.id]);

        const clienteRes = await pool.query('SELECT deuda_total FROM clientes WHERE id = $1', [req.params.id]);

        // 2. Si la cuenta llega a 0, pasamos automáticamente todas sus facturas a "Pagado"
        if (parseFloat(clienteRes.rows[0].deuda_total) <= 0) {
            await pool.query("UPDATE pedidos SET estado_pago = 'Pagado' WHERE cliente_id = $1 AND estado_pago = 'Parcial'", [req.params.id]);
            await pool.query('UPDATE clientes SET deuda_total = 0 WHERE id = $1', [req.params.id]); // Evita números negativos
        }

        res.json({ mensaje: 'Abono registrado con éxito' });
    } catch (err) {
        res.status(500).json({ error: 'Error procesando abono a la deuda' });
    }
});

// ==========================================
// ARRANQUE DEL SERVIDOR
// ==========================================
app.listen(3000, () => {
    console.log('🚀 Servidor Backend corriendo en el puerto 3000 (100% Moneda Base: COP)');
});