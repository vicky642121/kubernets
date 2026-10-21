BEGIN;

INSERT INTO public.products (id, name, price)
VALUES
    (1, 'Wireless Headphones', 1999.00),
    (2, 'Smart Watch', 2999.00),
    (3, 'Keyboard', 1499.00),
    (4, 'Mechanical Mouse', 899.00),
    (5, 'USB-C Charger', 1299.00),
    (6, 'Bluetooth Speaker', 2499.00),
    (7, 'Laptop Stand', 1199.00),
    (8, 'Webcam HD', 3499.00)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    id_sequence TEXT := pg_get_serial_sequence('public.products', 'id');
    max_id BIGINT;
BEGIN
    IF id_sequence IS NOT NULL THEN
        SELECT MAX(id) INTO max_id FROM public.products;
        PERFORM setval(id_sequence::regclass, COALESCE(max_id, 1), max_id IS NOT NULL);
    END IF;
END
$$;

COMMIT;
