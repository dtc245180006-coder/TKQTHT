const { Pool, types } = require('pg');
const audit = require('./audit');
const { blocking, BLOCKING_SQL } = require('./bookings/holds');
// Calendar dates must stay YYYY-MM-DD regardless of the server timezone.
types.setTypeParser(1082, value => value);
require('dotenv').config();
require('./secrets')();

let isPostgresConnected = false;
let pool = null;

// Initial sample rooms data
const initialRooms = [
  {
    id: 1,
    name: 'Phòng Deluxe King',
    type: 'Deluxe',
    price_per_night: 1200000,
    capacity: 2,
    description: 'Phòng cao cấp với giường King-size êm ái, ban công ngắm nhìn toàn cảnh thành phố, đầy đủ tiện nghi.',
    image_url: 'https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=800&q=80',
    amenities: ['Wifi miễn phí', 'Ban công view phố', 'Bồn tắm cao cấp', 'Bữa sáng miễn phí', 'Điều hòa 2 chiều'],
    status: 'available'
  },
  {
    id: 2,
    name: 'Phòng Standard Double',
    type: 'Standard',
    price_per_night: 750000,
    capacity: 2,
    description: 'Không gian ấm cúng, thiết kế hiện đại tối giản, trang bị tiện nghi đầy đủ cho chuyến công tác hoặc nghỉ dưỡng.',
    image_url: 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=800&q=80',
    amenities: ['Wifi tốc độ cao', 'Smart TV 50 inch', 'Tủ lạnh mini', 'Điều hòa', 'Bàn làm việc'],
    status: 'available'
  },
  {
    id: 3,
    name: 'Biệt Thự Hướng Biển (Ocean Villa)',
    type: 'Villa',
    price_per_night: 3500000,
    capacity: 4,
    description: 'Biệt thự riêng biệt sát bờ biển, có hồ bơi vô cực riêng, phòng khách sang trọng và bếp nướng BBQ ngoài trời.',
    image_url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
    amenities: ['Hồ bơi riêng', 'View trực diện biển', 'Phục vụ bữa sáng tận phòng', 'Quầy bar mini', 'Xe đưa đón sân bay'],
    status: 'available'
  },
  {
    id: 4,
    name: 'Phòng Executive Suite',
    type: 'Suite',
    price_per_night: 2200000,
    capacity: 3,
    description: 'Căn hộ suite đẳng cấp hoàng gia với phòng khách tách biệt phòng ngủ, nội thất gỗ óc chó tự nhiên.',
    image_url: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=800&q=80',
    amenities: ['Phòng khách riêng', 'Bồn sục Jacuzzi', 'Trà chiều miễn phí', 'Máy pha cà phê Nespresso', 'Wifi 6'],
    status: 'available'
  },
  {
    id: 5,
    name: 'Phòng Gia Đình Family Suite',
    type: 'Family',
    price_per_night: 1800000,
    capacity: 4,
    description: 'Phòng rộng 65m2 với 2 giường lớn, thiết kế an toàn cho trẻ nhỏ, phù hợp cho kỳ nghỉ gia đình trọn vẹn.',
    image_url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80',
    amenities: ['2 Giường Queen-size', 'Khu vui chơi trẻ em', 'Bữa sáng gia đình', 'Bồn tắm rộng', 'Máy lọc không khí'],
    status: 'available'
  },
  {
    id: 6,
    name: 'Penthouse Hoàng Gia View Panorama',
    type: 'Penthouse',
    price_per_night: 5200000,
    capacity: 6,
    description: 'Tầng cao nhất khách sạn với tầm nhìn 360 độ ngoạn mục, rạp chiếu phim mini, quản gia riêng 24/7.',
    image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80',
    amenities: ['Quản gia riêng 24/7', 'Rạp chiếu phim mini', 'Sân thượng ngắm sao', 'Hồ Jacuzzi nước nóng', 'Rượu vang chào mừng'],
    status: 'available'
  }
];

// In-Memory store for Windows standalone testing
let memoryRooms = JSON.parse(JSON.stringify(initialRooms));
let memoryBookings = [
  {
    id: 101,
    room_id: 1,
    room_name: 'Phòng Deluxe King',
    customer_name: 'Nguyễn Văn An',
    customer_phone: '0912345678',
    customer_email: 'an.nguyen@example.com',
    check_in_date: '2026-10-10',
    check_out_date: '2026-10-12',
    total_price: 2400000,
    status: 'confirmed',
    created_at: new Date().toISOString()
  }
];
let memoryCustomers = [{ id: 1, name: 'Nguyễn Văn An', phone: '0912345678', email: 'an.nguyen@example.com', notes: '' }];
memoryBookings[0].customer_id = 1;


memoryBookings.forEach(booking => { booking.guest_count = 1; });
const bookingStore = require('./bookings/store')({
  getPool: () => isPostgresConnected ? pool : null,
  rooms: memoryRooms, bookings: memoryBookings, customers: memoryCustomers
});

async function initDatabase() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'hotel_admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'hotel_booking_db',
    connectionTimeoutMillis: 3000
  };

  try {
    pool = new Pool(dbConfig);
    pool.on('error',error=>console.error('[Database]',error));
    const client = await pool.connect();
    isPostgresConnected = true;
    console.log(`[Database]  Kết nối thành công tới PostgreSQL tại ${dbConfig.host}:${dbConfig.port}`);

    if (process.env.DB_AUTO_MIGRATE === 'false') {
      try {
        const versions = await client.query('SELECT id FROM app_migrations');
        for (const id of ['booking_lifecycle_v1','booking_public_holds_v2','staff_accounts_v1','staff_audit_v1','deployment_roles_v1','booking_history_v3','stay_operations_v4','finance_controls_v5']) {
          if (!versions.rows.some(row => row.id === id)) throw new Error('Run the migration service before starting the application');
        }
        const privileges = (await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,
          has_schema_privilege(current_user,'public','CREATE') AS ddl FROM pg_roles WHERE rolname=current_user`)).rows[0];
        if (Object.values(privileges).some(Boolean)) throw new Error('Application database role has excessive privileges');
      } finally { client.release(); }
      return;
    }
    // Only the explicit migration job performs DDL in Docker deployments.
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        type VARCHAR(50) NOT NULL,
        price_per_night NUMERIC(12, 2) NOT NULL,
        capacity INT NOT NULL,
        description TEXT,
        image_url TEXT,
        amenities TEXT[],
        status VARCHAR(20) DEFAULT 'available'
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id) ON DELETE SET NULL,
        customer_name VARCHAR(120) NOT NULL,
        customer_phone VARCHAR(30) NOT NULL,
        customer_email VARCHAR(120) NOT NULL,
        check_in_date DATE NOT NULL,
        check_out_date DATE NOT NULL,
        total_price NUMERIC(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_room_dates
      ON bookings (room_id, check_in_date, check_out_date)
      WHERE status = 'confirmed';
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL,
        phone VARCHAR(30) NOT NULL, email VARCHAR(120) UNIQUE NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id);
    `);

    await require('./bookings/migrations')(client);

    // Check if rooms table is empty, then seed
    const checkRooms = await client.query('SELECT COUNT(*) FROM rooms');
    if (process.env.SEED_DEMO_DATA === 'true' && parseInt(checkRooms.rows[0].count, 10) === 0) {
      console.log('[Database]  Chưa có dữ liệu phòng, đang khởi tạo dữ liệu mẫu ban đầu...');
      for (const room of initialRooms) {
        await client.query(
          `INSERT INTO rooms (name, type, price_per_night, capacity, description, image_url, amenities, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [room.name, room.type, room.price_per_night, room.capacity, room.description, room.image_url, room.amenities, room.status]
        );
      }
      console.log('[Database]  Đã nạp 6 phòng khách sạn mẫu vào PostgreSQL!');
    }

    client.release();
  } catch (err) {
    isPostgresConnected = false;
    console.warn(`[Database] Không thể kết nối PostgreSQL (${err.message || err.code || 'unknown error'}).`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PostgreSQL is required in production');
    }
    console.log('[Database] Chuyển sang chế độ In-Memory dành riêng cho phát triển cục bộ.');
  }
}

// Data Access Methods
async function getRooms(filterType = '') {
  if (isPostgresConnected) {
    let queryText = 'SELECT * FROM rooms';
    const params = [];
    if (filterType) {
      queryText += ' WHERE type = $1';
      params.push(filterType);
    }
    queryText += ' ORDER BY id ASC';
    const res = await pool.query(queryText, params);
    return res.rows;
  }

  // Memory fallback
  if (filterType) {
    return memoryRooms.filter(r => r.type.toLowerCase() === filterType.toLowerCase());
  }
  return memoryRooms;
}

async function getRoomById(id) {
  const roomId = parseInt(id, 10);
  if (isPostgresConnected) {
    const res = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    return res.rows[0] || null;
  }
  return memoryRooms.find(r => r.id === roomId) || null;
}



async function createRoom(data, tx) {
  const { name, type, pricePerNight, capacity, description = '', imageUrl = '', amenities = [], status = 'available' } = data;
  if (isPostgresConnected) {
    const res = await (tx || pool).query(
      `INSERT INTO rooms (name, type, price_per_night, capacity, description, image_url, amenities, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, type, pricePerNight, capacity, description, imageUrl, amenities, status]
    );
    return res.rows[0];
  }
  const room = {
    id: memoryRooms.length ? Math.max(...memoryRooms.map(r => r.id)) + 1 : 1,
    name, type, price_per_night: Number(pricePerNight), capacity: Number(capacity),
    description, image_url: imageUrl, amenities, status
  };
  memoryRooms.push(room);
  return room;
}

async function updateRoom(id, data, tx) {
  const roomId = Number(id);
  const { name, type, pricePerNight, capacity, description = '', imageUrl = '', amenities = [], status = 'available' } = data;
  function check(active) {
    if (status === 'retired' && active.length) {
      const error = new Error('Cần xử lý hết đơn đang giữ phòng, đã xác nhận hoặc đang lưu trú trước khi ngừng kinh doanh.');
      error.status = 409; throw error;
    }
    if (active.some(b => b.guest_count > Number(capacity))) {
      const error = new Error('Sức chứa mới thấp hơn số khách của đơn đang hoạt động.');
      error.status = 409; throw error;
    }
    if (status === 'maintenance' && active.some(b => b.status === 'checked_in')) {
      const error = new Error('Không chuyển bảo trì khi phòng đang có khách lưu trú.');
      error.status = 409; throw error;
    }
  }
  if (isPostgresConnected) {
    const client = tx || await pool.connect();
    try {
      if (!tx) await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(80462060)');
      const room = await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      if (!room.rowCount) { if (!tx) await client.query('ROLLBACK'); return null; }
      const active = await client.query(`SELECT guest_count,status FROM booking_current WHERE room_id=$1 AND ${BLOCKING_SQL}`, [roomId]);
      check(active.rows);
      const result = await client.query('UPDATE rooms SET name=$2,type=$3,price_per_night=$4,capacity=$5,description=$6,image_url=$7,amenities=$8,status=$9 WHERE id=$1 RETURNING *',
        [roomId,name,type,pricePerNight,capacity,description,imageUrl,amenities,status]);
      if (!tx) await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { if (!tx) await client.query('ROLLBACK'); throw error; }
    finally { if (!tx) client.release(); }
  }
  const index = memoryRooms.findIndex(r => r.id === roomId);
  if (index < 0) return null;
  check(bookingStore.currentBookings().filter(b => b.room_id === roomId && blocking(b)));
  memoryRooms[index] = { ...memoryRooms[index], name, type, price_per_night: Number(pricePerNight), capacity: Number(capacity), description, image_url: imageUrl, amenities, status };
  return memoryRooms[index];
}

async function deleteRoom(id, tx) {
  const roomId = Number(id);
  if (isPostgresConnected) {
    const client = tx || await pool.connect();
    try {
      if (!tx) await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(80462060)');
      await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      const active = await client.query('SELECT 1 FROM bookings WHERE room_id=$1 UNION ALL SELECT 1 FROM booking_revisions WHERE room_id=$1 LIMIT 1', [roomId]);
      if (active.rowCount) { if (!tx) await client.query('ROLLBACK'); return { conflict: true }; }
      const res = await client.query('DELETE FROM rooms WHERE id=$1 RETURNING id', [roomId]);
      if (!tx) await client.query('COMMIT'); return res.rowCount ? { deleted: true } : null;
    } catch (error) { if (!tx) await client.query('ROLLBACK'); throw error; }
    finally { if (!tx) client.release(); }
  }
  if (await bookingStore.hasRoomHistory(roomId)) return { conflict: true };
  const index = memoryRooms.findIndex(r => r.id === roomId);
  if (index < 0) return null;
  memoryRooms.splice(index, 1);
  return { deleted: true };
}



function getDbStatus() {
  return {
    connected: isPostgresConnected,
    type: isPostgresConnected ? 'PostgreSQL' : 'In-Memory (Local Test Mode)',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'hotel_booking_db'
  };
}

async function getCustomers() {
  if (isPostgresConnected) return (await pool.query(`SELECT c.*,COUNT(b.id)::int AS booking_count,
    COALESCE(SUM(p.net_paid),0) AS total_spent,
    COALESCE(SUM(b.total_price) FILTER (WHERE b.status NOT IN ('cancelled','expired','no_show')),0) AS booking_value
    FROM customers c LEFT JOIN booking_current b ON b.customer_id=c.id
    LEFT JOIN (SELECT booking_id,SUM(amount) AS net_paid FROM booking_payments GROUP BY booking_id) p ON p.booking_id=b.id
    GROUP BY c.id ORDER BY c.id DESC`)).rows;
  const rows = await bookingStore.list();
  return memoryCustomers.map(customer => {
    const own = rows.filter(b => b.customer_id === customer.id);
    return { ...customer, booking_count: own.length,
      total_spent: own.reduce((sum,b) => sum + Number(b.paid_amount),0),
      booking_value: own.filter(b => !['cancelled','expired','no_show'].includes(b.status)).reduce((sum,b) => sum + Number(b.total_price),0) };
  });
}

async function saveCustomer(id, data, tx) {
  const values = [data.name.trim(), data.phone.trim(), data.email.trim().toLowerCase(), String(data.notes || '').slice(0, 2000)];
  if (isPostgresConnected) {
    const result = id ? await (tx || pool).query('UPDATE customers SET name=$1,phone=$2,email=$3,notes=$4 WHERE id=$5 RETURNING *', [...values, Number(id)]) :
      await (tx || pool).query('INSERT INTO customers (name,phone,email,notes) VALUES ($1,$2,$3,$4) RETURNING *', values);
    return result.rows[0] || null;
  }
  if (memoryCustomers.some(c => c.email === values[2] && c.id !== Number(id))) { const e = new Error('DUPLICATE'); e.code = '23505'; throw e; }
  let customer = id ? memoryCustomers.find(c => c.id === Number(id)) : { id: Math.max(0, ...memoryCustomers.map(c => c.id)) + 1 };
  if (!customer) return null;
  Object.assign(customer, { name: values[0], phone: values[1], email: values[2], notes: values[3] });
  if (!id) memoryCustomers.push(customer);
  return customer;
}
async function deleteCustomer(id, tx) {
  if (isPostgresConnected) {
    const used = await (tx || pool).query('SELECT 1 FROM bookings WHERE customer_id=$1 LIMIT 1', [Number(id)]);
    if (used.rowCount) return { conflict: true };
    return (await (tx || pool).query('DELETE FROM customers WHERE id=$1 RETURNING id', [Number(id)])).rowCount ? { deleted: true } : null;
  }
  if (memoryBookings.some(b => b.customer_id === Number(id))) return { conflict: true };
  const index = memoryCustomers.findIndex(c => c.id === Number(id));
  if (index < 0) return null;
  memoryCustomers.splice(index, 1); return { deleted: true };
}

module.exports = {
  getPool: () => isPostgresConnected ? pool : null,
  getCustomers,
  saveCustomer: (id,data,actor)=>audit.run({actor,action:id?'customer.update':'customer.create',entity:'customer',entityId:Number(id)||null},tx=>saveCustomer(id,data,tx)),
  deleteCustomer: (id,actor)=>audit.run({actor,action:'customer.delete',entity:'customer',entityId:Number(id)},tx=>deleteCustomer(id,tx)),
  initDatabase,
  getRooms,
  getRoomById,
  createRoom: (data,actor)=>audit.run({actor,action:'room.create',entity:'room'},tx=>createRoom(data,tx)),
  updateRoom: (id,data,actor)=>{const work=()=>audit.run({actor,action:'room.update',entity:'room',entityId:Number(id)},tx=>updateRoom(id,data,tx));return isPostgresConnected?work():bookingStore.exclusive(work);},
  deleteRoom: (id,actor)=>{const work=()=>audit.run({actor,action:'room.delete',entity:'room',entityId:Number(id)},tx=>deleteRoom(id,tx));return isPostgresConnected?work():bookingStore.exclusive(work);},
  createBooking: bookingStore.create,
  getBookings: bookingStore.list,
  getBlockingRoomIds: bookingStore.blockingRoomIds,
  expirePendingBookings: bookingStore.expirePending,
  cancelBooking: (id, actor) => bookingStore.transition(Number(id), 'cancel', actor),
  transitionBooking: bookingStore.transition,
  recordPayment: bookingStore.pay,
  finance: bookingStore.finance,
  getBookingHistory: bookingStore.history,
  reviseBooking: bookingStore.revise,
  cleanRoom: bookingStore.cleanRoom,
  getDbStatus
};
