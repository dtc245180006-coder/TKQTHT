const {cents, amount} = require('./rules');
// Capture only server-selected values while the room row is locked.
module.exports = function snapshot(room, data, total, now) {
  const nights=(Date.parse(data.checkOutDate)-Date.parse(data.checkInDate))/86400000;
  const rate=amount(cents(room.price_per_night));
  return {
    version:1, captured_at:new Date(now).toISOString(),
    room:{id:room.id,name:room.name,type:room.type},
    pricing:{currency:'VND',nightly_rate:rate,nights,
      items:[{code:'room',label:'Tiền phòng',quantity:nights,unit_price:rate,amount:total}],total}
  };
};
