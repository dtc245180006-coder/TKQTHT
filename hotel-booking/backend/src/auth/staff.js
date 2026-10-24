const { randomBytes } = require('node:crypto');
const users = require('./users');
const audit = require('../audit');
const { hashPassword, verifyPassword } = require('./passwords');
function fail(status, code, message) { throw Object.assign(new Error(message),{status,code}); }
const validPassword = value => typeof value==='string' && value.length>=12 && value.length<=128 && !value.startsWith('CHANGE_ME');
function name(value) {
  if (typeof value!=='string' || value.trim().length<2 || value.trim().length>120) fail(400,'INVALID_NAME','Tên hiển thị cần từ 2 đến 120 ký tự.');
  return value.trim();
}
async function reauthenticate(actor, password) {
  if (typeof password!=='string' || password.length>128) fail(400,'PASSWORD_REQUIRED','Nhập mật khẩu hiện tại của bạn để xác nhận.');
  const current = await users.findById(actor.id);
  if (!current?.active || current.session_version!==actor.sessionVersion) fail(401,'AUTH_REQUIRED','Phiên đã bị thu hồi. Vui lòng đăng nhập lại.');
  if (!await verifyPassword(password,current.password_hash)) fail(403,'PASSWORD_INCORRECT','Mật khẩu xác nhận không đúng.');
  return current;
}
async function checkActor(actor, snapshot, client, admin = true) {
  const current = await users.findById(actor.id,client);
  if (!current?.active || current.session_version!==snapshot.session_version || current.password_hash!==snapshot.password_hash) fail(401,'AUTH_REQUIRED','Phiên đã bị thu hồi. Vui lòng đăng nhập lại.');
  if (admin && current.role!=='admin') fail(403,'FORBIDDEN','Chỉ quản trị được quản lý tài khoản.');
}
async function manage(actor, operation, id, body) {
  const snapshot = await reauthenticate(actor,body.adminPassword);
  if (snapshot.role!=='admin') fail(403,'FORBIDDEN','Chỉ quản trị được quản lý tài khoản.');
  if (typeof body.reason!=='string' || body.reason.trim().length<3 || body.reason.length>300) fail(400,'REASON_REQUIRED','Nhập lý do từ 3 đến 300 ký tự.');
  const metadata = { reason:body.reason.trim() };
  const options = { actor,action:`staff.${operation}`,entity:'staff',entityId:id,metadata,staffLock:true };
  let passwordHash, temporaryPassword;
  if (['create','reset-password'].includes(operation)) {
    temporaryPassword = randomBytes(18).toString('base64url');
    passwordHash = await hashPassword(temporaryPassword);
  }
  return audit.run(options,async client=>{
    await checkActor(actor,snapshot,client);
    if (operation==='create') {
      if (typeof body.username!=='string' || !/^[a-z0-9._-]{3,64}$/.test(body.username.trim().toLowerCase())) fail(400,'INVALID_USERNAME','Tên đăng nhập cần 3–64 ký tự chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
      if (!['admin','receptionist'].includes(body.role)) fail(400,'INVALID_ROLE','Vai trò không hợp lệ.');
      const created = await users.create({ username:body.username.trim().toLowerCase(),display_name:name(body.displayName),
        role:body.role,password_hash:passwordHash,must_change_password:true },client);
      if (!created) fail(409,'USERNAME_EXISTS','Tên đăng nhập đã tồn tại.');
      metadata.username = created.username;
      metadata.role = created.role;
      return { user:users.safe(created), temporaryPassword };
    }
    const target = await users.findById(id,client);
    if (!target) fail(404,'STAFF_NOT_FOUND','Không tìm thấy tài khoản.');
    metadata.username = target.username;
    let changes;
    if (operation==='update') {
      if (!['admin','receptionist'].includes(body.role) || typeof body.active!=='boolean') fail(400,'INVALID_STAFF','Vai trò hoặc trạng thái không hợp lệ.');
      if (id===actor.id && (!body.active || body.role!=='admin')) fail(409,'SELF_LOCK','Không tự khóa hoặc hạ quyền của mình. Hãy dùng quản trị khác.');
      const admins = (await users.all(client)).filter(user=>user.active && user.role==='admin');
      if (target.active && target.role==='admin' && (!body.active || body.role!=='admin') && admins.length<=1) fail(409,'LAST_ADMIN','Phải giữ ít nhất một quản trị đang hoạt động.');
      changes = { display_name:name(body.displayName),role:body.role,active:body.active };
      if (body.role!==target.role || body.active!==target.active) changes.session_version = target.session_version+1;
      metadata.before = { role:target.role,active:target.active };
      metadata.after = { role:body.role,active:body.active };
    } else if (operation==='reset-password') {
      if (id===actor.id) fail(409,'SELF_RESET','Đổi mật khẩu của bạn tại trang Tài khoản.');
      changes = { password_hash:passwordHash,must_change_password:true,session_version:target.session_version+1,temporary_password_expires_at:new Date(Date.now()+24*60*60*1000).toISOString() };
    } else if (operation==='revoke-sessions') changes = { session_version:target.session_version+1 };
    else fail(400,'INVALID_OPERATION','Thao tác không hợp lệ.');
    const updated = await users.update(id,changes,client);
    return { user:users.safe(updated), ...(temporaryPassword ? {temporaryPassword} : {}) };
  });
}
async function changePassword(actor, body) {
  if (!validPassword(body.newPassword) || body.newPassword===body.currentPassword) fail(400,'INVALID_PASSWORD','Mật khẩu mới cần 12–128 ký tự, khác mật khẩu hiện tại và không dùng giá trị mẫu.');
  const snapshot = await reauthenticate(actor,body.currentPassword);
  const encoded = await hashPassword(body.newPassword);
  return audit.run({actor,action:'staff.change-password',entity:'staff',entityId:actor.id,staffLock:true},async client=>{
    await checkActor(actor,snapshot,client,false);
    await users.update(actor.id,{ password_hash:encoded,must_change_password:false,session_version:snapshot.session_version+1,temporary_password_expires_at:null },client);
    return { reauthenticate:true };
  });
}
module.exports = { manage, changePassword, reauthenticate, checkActor };
