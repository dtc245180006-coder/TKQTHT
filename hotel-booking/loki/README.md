# Truy vấn log trong Grafana

Mở Explore, chọn datasource Loki. Chọn khoảng thời gian có log.

Promtail thu log Docker trên Ubuntu khi bật profile linux-host-logs:

```logql
{job="docker"}
{job="docker"} |~ "(?i)error|fatal|exception"
sum by (container_id) (count_over_time({job="docker"}[5m]))
```

Alloy thu log ứng dụng từ volume dùng chung, kể cả trên Docker Desktop:

```logql
{job="hotel-backend"}
```
