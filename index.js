const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta de prueba para verificar el motor
app.get('/api/estado', async (req, res) => {
    try {
        // Le pedimos a PostgreSQL que nos devuelva la hora del sistema
        const result = await pool.query('SELECT NOW()');
        res.json({
            mensaje: '¡El motor del sistema está en línea y conectado a PostgreSQL!',
            hora_servidor: result.rows[0].now
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error conectando a la base de datos');
    }
});

// ==========================================
// MÓDULO DE CATEGORÍAS Y PRODUCTOS
// ==========================================

// 1. Crear una nueva categoría (Ej: "Desayunos" o "Comida Rápida")
app.post('/api/categorias', async (req, res) => {
    try {
        const { nombre, turno } = req.body; // turno puede ser: 'Mañana', 'Noche', 'Ambos'
        const nuevoRegistro = await pool.query(
            'INSERT INTO categorias (nombre, turno) VALUES ($1, $2) RETURNING *',
            [nombre, turno]
        );
        res.json({ mensaje: 'Categoría creada', categoria: nuevoRegistro.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor al crear categoría');
    }
});

// 2. Crear un nuevo producto (Ej: "Hamburguesa Especial")
app.post('/api/productos', async (req, res) => {
    try {
        const { nombre, categoria_id, precio_venta_usd } = req.body;
        const nuevoProducto = await pool.query(
            'INSERT INTO productos (nombre, categoria_id, precio_venta_usd) VALUES ($1, $2, $3) RETURNING *',
            [nombre, categoria_id, precio_venta_usd]
        );
        res.json({ mensaje: 'Producto creado', producto: nuevoProducto.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor al crear producto');
    }
});

// 3. Ver todos los productos con su categoría y turno asignado
app.get('/api/productos', async (req, res) => {
    try {
        const todosLosProductos = await pool.query(`
      SELECT p.id, p.nombre AS producto, p.precio_venta_usd, c.nombre AS categoria, c.turno
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.disponible = TRUE
    `);
        res.json(todosLosProductos.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor al obtener productos');
    }
});

// ==========================================
// MÓDULO DE VENTAS Y PEDIDOS
// ==========================================

// 1. Abrir un nuevo pedido (El "Ticket" principal)
app.post('/api/pedidos', async (req, res) => {
    try {
        // cliente_id puede ser null si es un cliente de paso que no registras
        const { cliente_id, total_usd, turno, observaciones } = req.body;

        const nuevoPedido = await pool.query(
            `INSERT INTO pedidos (cliente_id, total_usd, turno, observaciones) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
            [cliente_id, total_usd, turno, observaciones]
        );

        res.json({
            mensaje: 'Pedido abierto con éxito',
            pedido: nuevoPedido.rows[0]
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor al crear el pedido');
    }
});

// 2. Agregar productos a un pedido específico
app.post('/api/pedidos/:id/detalles', async (req, res) => {
    try {
        const pedido_id = req.params.id;
        const { producto_id, cantidad, precio_unitario_usd } = req.body;
        const subtotal_usd = cantidad * precio_unitario_usd;

        const nuevoDetalle = await pool.query(
            `INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario_usd, subtotal_usd) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [pedido_id, producto_id, cantidad, precio_unitario_usd, subtotal_usd]
        );

        res.json({
            mensaje: 'Producto agregado al pedido',
            detalle: nuevoDetalle.rows[0]
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor al agregar detalle al pedido');
    }
});

// 3. Ver las ventas del día (Ideal para hacer el corte de caja)
app.get('/api/ventas/hoy', async (req, res) => {
    try {
        const ventasHoy = await pool.query(`
      SELECT id, total_usd, estado_pago, turno, observaciones, fecha_hora 
      FROM pedidos 
      WHERE DATE(fecha_hora) = CURRENT_DATE
      ORDER BY fecha_hora DESC
    `);

        // Sumamos el total del día para tener la métrica rápida
        const totalCaja = ventasHoy.rows.reduce((acc, pedido) => acc + parseFloat(pedido.total_usd), 0);

        res.json({
            total_recaudado_usd: totalCaja,
            cantidad_pedidos: ventasHoy.rows.length,
            pedidos: ventasHoy.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error al obtener las ventas del día');
    }
});

// ==========================================
// MÓDULO DE INVENTARIO Y RECETAS (COSTOS)
// ==========================================

// 1. Registrar un insumo/materia prima (Ej: Carne molida)
app.post('/api/insumos', async (req, res) => {
    try {
        const { nombre, unidad_medida, costo_actual, stock_actual } = req.body;
        const nuevoInsumo = await pool.query(
            `INSERT INTO insumos (nombre, unidad_medida, costo_actual, stock_actual) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
            [nombre, unidad_medida, costo_actual, stock_actual]
        );
        res.json({ mensaje: 'Insumo registrado', insumo: nuevoInsumo.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error al registrar insumo');
    }
});

// 2. Armar la receta (Ej: La Hamburguesa Especial lleva 0.150 Kg de carne)
app.post('/api/recetas', async (req, res) => {
    try {
        const { producto_id, insumo_id, cantidad_necesaria } = req.body;
        const nuevaReceta = await pool.query(
            `INSERT INTO recetas (producto_id, insumo_id, cantidad_necesaria) 
       VALUES ($1, $2, $3) RETURNING *`,
            [producto_id, insumo_id, cantidad_necesaria]
        );
        res.json({ mensaje: 'Ingrediente agregado a la receta', receta: nuevaReceta.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error al armar la receta');
    }
});

// 3. LA MAGIA: Calcular cuánto cuesta hacer un producto
app.get('/api/productos/:id/costo', async (req, res) => {
    try {
        const producto_id = req.params.id;
        const calculo = await pool.query(`
      SELECT 
        p.nombre AS producto,
        p.precio_venta_usd,
        COALESCE(SUM(i.costo_actual * r.cantidad_necesaria), 0) AS costo_produccion_usd,
        (p.precio_venta_usd - COALESCE(SUM(i.costo_actual * r.cantidad_necesaria), 0)) AS ganancia_neta_usd
      FROM productos p
      LEFT JOIN recetas r ON p.id = r.producto_id
      LEFT JOIN insumos i ON r.insumo_id = i.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [producto_id]);

        res.json(calculo.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error calculando el costo del producto');
    }
});

// ==========================================
// MÓDULO MULTIMONEDA Y TASAS DE CAMBIO
// ==========================================

// 1. Actualizar o registrar la tasa del día (Ej: COP o BS)
app.post('/api/tasas', async (req, res) => {
    try {
        const { moneda, tasa } = req.body;

        // Primero revisamos si esa moneda ya la teníamos registrada
        const existe = await pool.query('SELECT id FROM tasas_cambio WHERE moneda = $1', [moneda]);

        let resultado;
        if (existe.rows.length > 0) {
            // Si existe, solo actualizamos el valor y la hora
            resultado = await pool.query(
                'UPDATE tasas_cambio SET tasa = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE moneda = $2 RETURNING *',
                [tasa, moneda]
            );
        } else {
            // Si es nueva, la creamos
            resultado = await pool.query(
                'INSERT INTO tasas_cambio (moneda, tasa) VALUES ($1, $2) RETURNING *',
                [moneda, tasa]
            );
        }

        res.json({ mensaje: `Tasa de ${moneda} actualizada con éxito`, tasa: resultado.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error al actualizar la tasa de cambio');
    }
});

// 2. Ver todas las tasas activas actualmente
app.get('/api/tasas', async (req, res) => {
    try {
        const tasas = await pool.query('SELECT * FROM tasas_cambio');
        res.json(tasas.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error obteniendo las tasas');
    }
});

// 3. LA CALCULADORA MÁGICA: Obtener el total de un pedido en todas las monedas
app.get('/api/pedidos/:id/totales', async (req, res) => {
    try {
        const pedido_id = req.params.id;

        // Buscamos el total del ticket en dólares
        const pedido = await pool.query('SELECT total_usd FROM pedidos WHERE id = $1', [pedido_id]);
        if (pedido.rows.length === 0) return res.status(404).send('Pedido no encontrado');

        const totalUsd = parseFloat(pedido.rows[0].total_usd);

        // Traemos las tasas de la base de datos
        const tasas = await pool.query('SELECT moneda, tasa FROM tasas_cambio');

        // Empezamos a armar el recibo final
        let recibo = {
            Total_USD: totalUsd.toFixed(2),
        };

        // Multiplicamos el total en dólares por cada tasa que tengas registrada
        tasas.rows.forEach(t => {
            recibo[`Total_${t.moneda}`] = (totalUsd * parseFloat(t.tasa)).toFixed(2);
        });

        res.json({
            mensaje: 'Cálculo generado al instante',
            recibo_cliente: recibo
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error calculando totales multimoneda');
    }
});

// ==========================================
// MÓDULO DE PAGOS Y CUENTAS POR COBRAR (FIADOS)
// ==========================================

// 1. Registrar un pago parcial o total a una factura
app.post('/api/pedidos/:id/pagos', async (req, res) => {
    try {
        const pedido_id = req.params.id;
        const { monto_pagado, moneda_pago, tasa_aplicada, cliente_id } = req.body;

        // Registramos el pago en el historial
        const nuevoPago = await pool.query(
            `INSERT INTO pagos (pedido_id, monto_pagado, moneda_pago, tasa_aplicada) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
            [pedido_id, monto_pagado, moneda_pago, tasa_aplicada]
        );

        // Actualizamos el estado del pedido a "Parcial"
        await pool.query(
            `UPDATE pedidos SET estado_pago = 'Parcial' WHERE id = $1`,
            [pedido_id]
        );

        // Si hay un cliente asociado, le sumamos este movimiento a su perfil
        // (En un sistema avanzado, aquí restaríamos la deuda total del cliente)
        if (cliente_id) {
            await pool.query(
                `UPDATE clientes SET deuda_total = deuda_total - $1 WHERE id = $2`,
                [(monto_pagado / tasa_aplicada), cliente_id] // Convertimos el pago a USD para restar
            );
        }

        res.json({ mensaje: 'Pago registrado exitosamente', recibo: nuevoPago.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error al procesar el pago');
    }
});

// 2. Ver la lista negra (Clientes que deben dinero)
app.get('/api/clientes/deudores', async (req, res) => {
    try {
        const deudores = await pool.query(`
      SELECT id, nombre, telefono, deuda_total 
      FROM clientes 
      WHERE deuda_total > 0
      ORDER BY deuda_total DESC
    `);

        res.json({
            total_dinero_en_calle_usd: deudores.rows.reduce((acc, c) => acc + parseFloat(c.deuda_total), 0),
            clientes: deudores.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error consultando deudores');
    }
});

// Actualizar el precio de un producto en tiempo real
app.put('/api/productos/:id/precio', async (req, res) => {
    try {
        const { nuevo_precio } = req.body;
        const actualizado = await pool.query(
            'UPDATE productos SET precio_venta_usd = $1 WHERE id = $2 RETURNING *',
            [nuevo_precio, req.params.id]
        );
        res.json({ mensaje: 'Precio actualizado', producto: actualizado.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error actualizando el precio');
    }
});

// Encendemos el servidor
app.listen(PORT, () => {
    console.log(`Servidor de control corriendo en http://localhost:${PORT}`);
});