export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
export const $ = (id) => document.getElementById(id);
export const money = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 2,
  }).format(Number(value));
export const day = (value) => String(value || "").slice(0, 10);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const nextDay = (value) =>
  new Date(Date.parse(value) + 86400000).toISOString().slice(0, 10);
export const normalize = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
export const localPhotos = [
  "1591088398332-8a7791972843",
  "1566665797739-1674de7a421a",
  "1582719478250-c89cae4dc85b",
  "1618773928121-c32242e63f39",
  "1595526114035-0d45ed16cfbf",
  "1502672260266-1c1ef2d93688",
];
export const image = (value) => {
  const photo = localPhotos.find((p) => String(value).includes(`photo-${p}`));
  return photo
    ? `/images/photo-${photo}.jpg`
    : /^https:\/\/images\.unsplash\.com\//.test(value || "")
      ? value
      : "/images/room-placeholder.svg";
};
