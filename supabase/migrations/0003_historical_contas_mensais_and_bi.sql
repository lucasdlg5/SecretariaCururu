-- ==============================================================================
-- MIGRATION: 0003_historical_contas_mensais_and_bi.sql
-- Captura Real da Pasta "Contas Mensais" (Google Drive: 1Xe9NditnlI8eLQl-kMZgPVoCUlvgVZ73)
-- Inclui Métricas de Consumo (kWh / m³), Tarifas Unitárias, Impostos, Bandeiras e BI
-- ==============================================================================

-- 1. Adicionar colunas de Business Intelligence (Consumo, Tarifa, Impostos, Dias de Leitura, Metadados BI)
ALTER TABLE public.bill_cycles
    ADD COLUMN IF NOT EXISTS consumption_value NUMERIC(10, 3),
    ADD COLUMN IF NOT EXISTS consumption_unit TEXT,
    ADD COLUMN IF NOT EXISTS unit_tariff_brl NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS tax_amount_cents INTEGER,
    ADD COLUMN IF NOT EXISTS tariff_flag TEXT,
    ADD COLUMN IF NOT EXISTS billing_days INTEGER,
    ADD COLUMN IF NOT EXISTS predicted_due_date DATE,
    ADD COLUMN IF NOT EXISTS bi_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Garantir provedor de Água (SAAE Jacareí) ativo e provedor de IPTU & Taxa de Lixo
UPDATE public.bill_providers
SET name = 'Água - SAAE Jacareí',
    is_active = true,
    trigger_day = 23,
    due_day_default = 13,
    portal_url = 'https://www.saaejacarei.sp.gov.br/'
WHERE category = 'AGUA';

UPDATE public.bill_providers
SET due_day_default = 8
WHERE category = 'LUZ';

UPDATE public.bill_providers
SET due_day_default = 4
WHERE category = 'GAS';

UPDATE public.bill_providers
SET due_day_default = 20
WHERE category = 'INTERNET';

UPDATE public.bill_providers
SET due_day_default = 30
WHERE category = 'ALUGUEL';

UPDATE public.bill_providers
SET due_day_default = 10
WHERE category = 'CONDOMINIO';

INSERT INTO public.bill_providers (
    name,
    category,
    mode,
    is_active,
    trigger_day,
    due_day_default,
    portal_url,
    max_retry_days,
    workflow_steps,
    fallback_workflow_steps,
    encrypted_secrets
) VALUES (
    'IPTU & Taxa de Lixo',
    'OUTROS',
    'MANUAL_REMINDER',
    true,
    22,
    30,
    NULL,
    3,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- 3. Upsert de todo o histórico real capturado da pasta "Contas Mensais" (2025-11 a 2026-09)
DO $$
DECLARE
    v_luz_id UUID;
    v_agua_id UUID;
    v_gas_id UUID;
    v_net_id UUID;
    v_aluguel_id UUID;
    v_condo_id UUID;
    v_iptu_id UUID;
BEGIN
    SELECT id INTO v_luz_id FROM public.bill_providers WHERE category = 'LUZ' LIMIT 1;
    SELECT id INTO v_agua_id FROM public.bill_providers WHERE category = 'AGUA' LIMIT 1;
    SELECT id INTO v_gas_id FROM public.bill_providers WHERE category = 'GAS' LIMIT 1;
    SELECT id INTO v_net_id FROM public.bill_providers WHERE category = 'INTERNET' LIMIT 1;
    SELECT id INTO v_aluguel_id FROM public.bill_providers WHERE category = 'ALUGUEL' LIMIT 1;
    SELECT id INTO v_condo_id FROM public.bill_providers WHERE category = 'CONDOMINIO' LIMIT 1;
    SELECT id INTO v_iptu_id FROM public.bill_providers WHERE name = 'IPTU & Taxa de Lixo' LIMIT 1;

    -- =========================================================================
    -- 3.1. LUZ - EDP SÃO PAULO (2026-05 a 2026-08 + Comprovante Setembro)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, consumption_value, consumption_unit, unit_tariff_brl,
        tax_amount_cents, tariff_flag, billing_days, bi_metadata
    ) VALUES
    (
        v_luz_id, '2026-05', 'PAID_RECONCILED', 9025, '2026-06-08',
        '1jSL-1B_mky-1uyheAIlV08QApydBDJH0', 'https://drive.google.com/file/d/1jSL-1B_mky-1uyheAIlV08QApydBDJH0/view',
        '1IbQ9iZCnSp30tqYSlv7W6_n8zHsNqfmW', 'https://drive.google.com/file/d/1IbQ9iZCnSp30tqYSlv7W6_n8zHsNqfmW/view',
        1, '2026-06-02T12:07:19Z', 95.000, 'kWh', 0.950000,
        1397, 'VERDE_AMARELA', 22,
        '{"tusd_rate": 0.540316, "te_rate": 0.390421, "flag_rate": 0.022305, "icms_pct": 12.0, "daily_avg_kwh": 4.32, "meter_reading": 876}'::jsonb
    ),
    (
        v_luz_id, '2026-06', 'PAID_RECONCILED', 26382, '2026-07-08',
        '17gPsVCF9TC3ZJUrWb8sAaLyhZLcCJ4UM', 'https://drive.google.com/file/d/17gPsVCF9TC3ZJUrWb8sAaLyhZLcCJ4UM/view',
        NULL, NULL,
        1, '2026-07-08T14:00:00Z', 258.000, 'kWh', 1.022558,
        5599, 'AMARELA', 31,
        '{"tusd_rate": 0.579690, "te_rate": 0.418953, "flag_rate": 0.023915, "icms_pct": 18.0, "daily_avg_kwh": 8.32, "meter_reading": 1134, "alert": "Salto de ICMS de 12% para 18% ao ultrapassar 200 kWh (+171,6% consumo)"}'::jsonb
    ),
    (
        v_luz_id, '2026-07', 'PAID_RECONCILED', 19391, '2026-08-10',
        '1QhdYfnxbYZAgq1kvUMrY_UCiPZKZN480', 'https://drive.google.com/file/d/1QhdYfnxbYZAgq1kvUMrY_UCiPZKZN480/view',
        '1U1p6VNXkFNo0HBGdiVUdoYKaCKeLwVJN', 'https://drive.google.com/file/d/1U1p6VNXkFNo0HBGdiVUdoYKaCKeLwVJN/view',
        1, '2026-08-09T13:26:51Z', 200.000, 'kWh', 0.969550,
        3280, 'AMARELA', 32,
        '{"tusd_rate": 0.549650, "te_rate": 0.397250, "flag_rate": 0.022650, "icms_pct": 12.0, "daily_avg_kwh": 6.25, "meter_reading": 1334}'::jsonb
    ),
    (
        v_luz_id, '2026-08', 'PAID_RECONCILED', 19363, '2026-09-08',
        '1lYgmmMcOzQ4c6OCLb0qBKVWt4O4bKxHI', 'https://drive.google.com/file/d/1lYgmmMcOzQ4c6OCLb0qBKVWt4O4bKxHI/view',
        '12UgoV3gpiQFujAL_giDde5VF1Pn6pzpg', 'https://drive.google.com/file/d/12UgoV3gpiQFujAL_giDde5VF1Pn6pzpg/view',
        1, '2026-09-10T17:13:54Z', 199.000, 'kWh', 0.973015,
        3332, 'AMARELA', 28,
        '{"tusd_rate": 0.551608, "te_rate": 0.398693, "flag_rate": 0.022714, "icms_pct": 12.0, "daily_avg_kwh": 7.11, "meter_reading": 1533}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        consumption_value = EXCLUDED.consumption_value,
        consumption_unit = EXCLUDED.consumption_unit,
        unit_tariff_brl = EXCLUDED.unit_tariff_brl,
        tax_amount_cents = EXCLUDED.tax_amount_cents,
        tariff_flag = EXCLUDED.tariff_flag,
        billing_days = EXCLUDED.billing_days,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.2. GÁS - COMGÁS (2026-05 a 2026-08)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, consumption_value, consumption_unit, unit_tariff_brl,
        tax_amount_cents, tariff_flag, billing_days, bi_metadata
    ) VALUES
    (
        v_gas_id, '2026-05', 'PAID_RECONCILED', 2792, '2026-06-03',
        '1wU4I-l-1RnNjXeMi1SubsVer2OFvo7F3', 'https://drive.google.com/file/d/1wU4I-l-1RnNjXeMi1SubsVer2OFvo7F3/view',
        '1j4BUfPbLMdi5tPVYpfDRl6y3N46k5aa3', 'https://drive.google.com/file/d/1j4BUfPbLMdi5tPVYpfDRl6y3N46k5aa3/view',
        1, '2026-06-02T12:03:57Z', 1.955, 'm³', 14.280126,
        638, 'NORMAL', 27,
        '{"gross_supply_cents": 2792, "icms_pct": 18.0, "daily_avg_m3": 0.072}'::jsonb
    ),
    (
        v_gas_id, '2026-06', 'PAID_RECONCILED', 1335, '2026-07-05',
        '1AUt7mzADc2JnlX1EJndQpn87Pb5shb2J', 'https://drive.google.com/file/d/1AUt7mzADc2JnlX1EJndQpn87Pb5shb2J/view',
        NULL, NULL,
        1, '2026-07-05T10:00:00Z', 2.930, 'm³', 14.085525,
        944, 'NORMAL', 30,
        '{"gross_supply_cents": 4127, "refund_duplicate_cents": -2792, "icms_pct": 18.0, "daily_avg_m3": 0.098, "note": "Fornecimento R$ 41,27 com devolução de pagamento em duplicidade de R$ 27,92"}'::jsonb
    ),
    (
        v_gas_id, '2026-07', 'PAID_RECONCILED', 1509, '2026-08-04',
        '1S74f_D9IPJDl1TPRYgCkrxZT-8fHe_xs', 'https://drive.google.com/file/d/1S74f_D9IPJDl1TPRYgCkrxZT-8fHe_xs/view',
        '15P-ijSXprF32wqABcKfyp8vsVPy6jqUJ', 'https://drive.google.com/file/d/15P-ijSXprF32wqABcKfyp8vsVPy6jqUJ/view',
        1, '2026-08-09T13:25:34Z', 0.981, 'm³', 15.386460,
        345, 'NORMAL', 30,
        '{"gross_supply_cents": 1509, "icms_pct": 18.0, "daily_avg_m3": 0.033}'::jsonb
    ),
    (
        v_gas_id, '2026-08', 'PDF_CAPTURED', 4788, '2026-09-03',
        '1D-qMeYsrPqT3a1Xds_v8Y_fnAYMeUirN', 'https://drive.google.com/file/d/1D-qMeYsrPqT3a1Xds_v8Y_fnAYMeUirN/view',
        NULL, NULL,
        1, NULL, 3.930, 'm³', 12.099985,
        1087, 'NORMAL', 32,
        '{"gross_supply_cents": 4755, "late_fee_cents": 33, "icms_pct": 18.0, "daily_avg_m3": 0.123, "alert": "Aumento de +300,6% no consumo de gás (3,93 m³ vs 0,98 m³ em Julho)"}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        consumption_value = EXCLUDED.consumption_value,
        consumption_unit = EXCLUDED.consumption_unit,
        unit_tariff_brl = EXCLUDED.unit_tariff_brl,
        tax_amount_cents = EXCLUDED.tax_amount_cents,
        tariff_flag = EXCLUDED.tariff_flag,
        billing_days = EXCLUDED.billing_days,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.3. ÁGUA - SAAE JACAREÍ (Histórico de Consumo 2025-12 a 2026-08)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, consumption_value, consumption_unit, unit_tariff_brl,
        tax_amount_cents, tariff_flag, billing_days, bi_metadata
    ) VALUES
    (
        v_agua_id, '2026-05', 'PAID_RECONCILED', 8664, '2026-06-13',
        '1htV0TfDBcaFLBfgrGwEHMwLZKHBPd5LJ', 'https://drive.google.com/file/d/1htV0TfDBcaFLBfgrGwEHMwLZKHBPd5LJ/view',
        '1IGmUlHJyVB5hgONvNKic78Lefp_m0TWX', 'https://drive.google.com/file/d/1IGmUlHJyVB5hgONvNKic78Lefp_m0TWX/view',
        1, '2026-06-08T10:59:20Z', 5.000, 'm³', 17.328000,
        0, 'FAIXA_MINIMA', 30,
        '{"agua_cents": 3800, "esgoto_cents": 3420, "rateio_agua_cents": 760, "rateio_esgoto_cents": 684, "history_m3": {"2025-11": 0, "2025-12": 4, "2026-01": 7, "2026-02": 8, "2026-03": 7, "2026-04": 2}}'::jsonb
    ),
    (
        v_agua_id, '2026-06', 'PAID_RECONCILED', 7942, '2026-07-13',
        '17IYMfOWd0MhBWAsX6SGBueE9tfFBtJGL', 'https://drive.google.com/file/d/17IYMfOWd0MhBWAsX6SGBueE9tfFBtJGL/view',
        NULL, NULL,
        1, '2026-07-13T12:00:00Z', 5.000, 'm³', 15.884000,
        0, 'FAIXA_MINIMA', 30,
        '{"agua_cents": 3800, "esgoto_cents": 3420, "rateio_agua_cents": 380, "rateio_esgoto_cents": 342}'::jsonb
    ),
    (
        v_agua_id, '2026-07', 'PAID_RECONCILED', 7942, '2026-08-13',
        '1BBA31XECPsM86_9H2qw2rupltizGUSDU', 'https://drive.google.com/file/d/1BBA31XECPsM86_9H2qw2rupltizGUSDU/view',
        '1fPDg7DsEU3gE0KAlVPXeLWDlL149oTr8', 'https://drive.google.com/file/d/1fPDg7DsEU3gE0KAlVPXeLWDlL149oTr8/view',
        1, '2026-08-09T13:28:21Z', 6.000, 'm³', 13.236667,
        0, 'FAIXA_MINIMA', 30,
        '{"agua_cents": 3800, "esgoto_cents": 3420, "rateio_agua_cents": 380, "rateio_esgoto_cents": 342, "card_fee_cents": 515, "total_paid_cents": 8457}'::jsonb
    ),
    (
        v_agua_id, '2026-08', 'PDF_CAPTURED', 7942, '2026-09-13',
        '1W4Z5GYoHh04SoyyFOFc8QLJMBRCsv3js', 'https://drive.google.com/file/d/1W4Z5GYoHh04SoyyFOFc8QLJMBRCsv3js/view',
        NULL, NULL,
        1, NULL, 6.000, 'm³', 13.236667,
        0, 'FAIXA_MINIMA', 30,
        '{"agua_cents": 3800, "esgoto_cents": 3420, "rateio_agua_cents": 380, "rateio_esgoto_cents": 342}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        consumption_value = EXCLUDED.consumption_value,
        consumption_unit = EXCLUDED.consumption_unit,
        unit_tariff_brl = EXCLUDED.unit_tariff_brl,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.4. INTERNET - NJCI / NET JACAREÍ (2026-05 a 2026-08)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, consumption_value, consumption_unit, unit_tariff_brl,
        tax_amount_cents, tariff_flag, billing_days, bi_metadata
    ) VALUES
    (
        v_net_id, '2026-05', 'PAID_RECONCILED', 13940, '2026-06-20',
        '1Y4xxxJctezq5mbWlE6tEwx3U_Bh-rfbC', 'https://drive.google.com/file/d/1Y4xxxJctezq5mbWlE6tEwx3U_Bh-rfbC/view',
        '1-wwH__7Ro-bysd2LCyRCFpFr3BG-5Tlz', 'https://drive.google.com/file/d/1-wwH__7Ro-bysd2LCyRCFpFr3BG-5Tlz/view',
        1, '2026-06-02T12:10:53Z', 1.000, 'plano', 139.400000,
        2154, 'FIXO', 19,
        '{"federal_tax_pct": 13.45, "municipal_tax_pct": 2.0}'::jsonb
    ),
    (
        v_net_id, '2026-06', 'PAID_RECONCILED', 13490, '2026-07-20',
        '1oa3eKjDePGuavf_Cen3AJbfJAw7vsioi', 'https://drive.google.com/file/d/1oa3eKjDePGuavf_Cen3AJbfJAw7vsioi/view',
        '1-BO65lE3AMcb0tNOPC2dQMGM_nzDTUoa', 'https://drive.google.com/file/d/1-BO65lE3AMcb0tNOPC2dQMGM_nzDTUoa/view',
        1, '2026-07-21T01:16:42Z', 1.000, 'plano', 134.900000,
        2084, 'FIXO', 30,
        '{"card_fee_cents": 471, "iof_cents": 84, "total_paid_cents": 14045}'::jsonb
    ),
    (
        v_net_id, '2026-07', 'PAID_RECONCILED', 13490, '2026-08-20',
        NULL, NULL,
        '1O5VhE1zyb9PRjfOaPROH5EFbJGvzYYsJ', 'https://drive.google.com/file/d/1O5VhE1zyb9PRjfOaPROH5EFbJGvzYYsJ/view',
        1, '2026-08-29T17:06:12Z', 1.000, 'plano', 134.900000,
        2084, 'FIXO', 30,
        '{}'::jsonb
    ),
    (
        v_net_id, '2026-08', 'PDF_CAPTURED', 13490, '2026-09-20',
        '1Umyts6AwcoACT_0Xs-1Zyof4NCnBbsoZ', 'https://drive.google.com/file/d/1Umyts6AwcoACT_0Xs-1Zyof4NCnBbsoZ/view',
        NULL, NULL,
        1, NULL, 1.000, 'plano', 134.900000,
        2084, 'FIXO', 30,
        '{}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.5. ALUGUEL MENSAL (Cristina Sarturi Imóveis — Vencimento Todo Dia 30)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, bi_metadata
    ) VALUES
    (
        v_aluguel_id, '2026-05', 'PAID_RECONCILED', 134333, '2026-05-30',
        '1OgWE4zGDveZUcPegIoOo1ptV7QFIeT8U', 'https://drive.google.com/file/d/1OgWE4zGDveZUcPegIoOo1ptV7QFIeT8U/view',
        '16P39rvDerN9bbQ2N2SL-gGQP8aLGEjm8', 'https://drive.google.com/file/d/16P39rvDerN9bbQ2N2SL-gGQP8aLGEjm8/view',
        1, '2026-05-29T20:17:44Z',
        '{"base_rent_cents": 130000, "proportional_days_cents": 4333, "total_boleto_imobiliaria_cents": 156899, "issued_date": "2026-05-26"}'::jsonb
    ),
    (
        v_aluguel_id, '2026-06', 'PAID_RECONCILED', 130000, '2026-06-30',
        '1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab', 'https://drive.google.com/file/d/1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab/view',
        '1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z', 'https://drive.google.com/file/d/1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z/view',
        1, '2026-06-30T18:15:21Z',
        '{"base_rent_cents": 130000, "total_boleto_imobiliaria_cents": 166222, "issued_date": "2026-06-22"}'::jsonb
    ),
    (
        v_aluguel_id, '2026-07', 'PAID_RECONCILED', 130000, '2026-07-30',
        '1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o', 'https://drive.google.com/file/d/1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o/view',
        '1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv', 'https://drive.google.com/file/d/1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv/view',
        1, '2026-07-30T19:55:44Z',
        '{"base_rent_cents": 130000, "total_boleto_imobiliaria_cents": 166222, "issued_date": "2026-07-27"}'::jsonb
    ),
    (
        v_aluguel_id, '2026-08', 'PAID_RECONCILED', 130000, '2026-08-30',
        '10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY', 'https://drive.google.com/file/d/10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY/view',
        NULL, NULL,
        1, '2026-08-30T22:08:58Z',
        '{"base_rent_cents": 130000, "total_boleto_imobiliaria_cents": 161858, "issued_date": "2026-08-24"}'::jsonb
    ),
    (
        v_aluguel_id, '2026-09', 'MANUAL_REQUIRED', 130000, '2026-09-30',
        NULL, NULL,
        NULL, NULL,
        1, NULL,
        '{"base_rent_cents": 130000, "predicted_from_history": true, "note": "Vencimento fixo dia 30 confirmado pela imobiliária"}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.6. CONDOMÍNIO RESIDENCIAL (Vista Bela — R$ 225,66 — Desmembrado para Dia 10 em Set/2026)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, bi_metadata
    ) VALUES
    (
        v_condo_id, '2026-05', 'PAID_RECONCILED', 22566, '2026-05-30',
        '1OgWE4zGDveZUcPegIoOo1ptV7QFIeT8U', 'https://drive.google.com/file/d/1OgWE4zGDveZUcPegIoOo1ptV7QFIeT8U/view',
        '16P39rvDerN9bbQ2N2SL-gGQP8aLGEjm8', 'https://drive.google.com/file/d/16P39rvDerN9bbQ2N2SL-gGQP8aLGEjm8/view',
        1, '2026-05-29T20:17:44Z',
        '{"bundled_with_rent": true}'::jsonb
    ),
    (
        v_condo_id, '2026-06', 'PAID_RECONCILED', 22566, '2026-06-30',
        '1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab', 'https://drive.google.com/file/d/1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab/view',
        '1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z', 'https://drive.google.com/file/d/1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z/view',
        1, '2026-06-30T18:15:21Z',
        '{"bundled_with_rent": true}'::jsonb
    ),
    (
        v_condo_id, '2026-07', 'PAID_RECONCILED', 22566, '2026-07-30',
        '1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o', 'https://drive.google.com/file/d/1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o/view',
        '1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv', 'https://drive.google.com/file/d/1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv/view',
        1, '2026-07-30T19:55:44Z',
        '{"bundled_with_rent": true}'::jsonb
    ),
    (
        v_condo_id, '2026-08', 'PAID_RECONCILED', 22566, '2026-08-30',
        '10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY', 'https://drive.google.com/file/d/10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY/view',
        NULL, NULL,
        1, '2026-08-30T22:08:58Z',
        '{"bundled_with_rent": true}'::jsonb
    ),
    (
        v_condo_id, '2026-09', 'PAID_RECONCILED', 22566, '2026-09-10',
        '1JtchP_fvAzUQc4I8p6RKv7cVRIyKiWvR', 'https://drive.google.com/file/d/1JtchP_fvAzUQc4I8p6RKv7cVRIyKiWvR/view',
        '18qYjTgUsb2RDYuifdDsffSt-rRemIZep', 'https://drive.google.com/file/d/18qYjTgUsb2RDYuifdDsffSt-rRemIZep/view',
        1, '2026-09-10T17:11:06Z',
        '{"bundled_with_rent": false, "splitwise_partner_share_cents": 11283, "note": "A partir de Set/2026 o condomínio passou a vencer separadamente todo dia 10"}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        bi_metadata = EXCLUDED.bi_metadata;

    -- =========================================================================
    -- 3.7. IPTU (6 parcelas de R$ 92,92) & TAXA DE LIXO (3 parcelas de R$ 43,64)
    -- =========================================================================
    INSERT INTO public.bill_cycles (
        provider_id, reference_month, status, amount_cents, due_date,
        invoice_drive_file_id, invoice_drive_url, receipt_drive_file_id, receipt_drive_url,
        attempt_count, paid_at, bi_metadata
    ) VALUES
    (
        v_iptu_id, '2026-05', 'PAID_RECONCILED', 13656, '2026-06-01',
        '1UKQsIXq2HX4U8VMetAOq5HG7S9THCsGd', 'https://drive.google.com/file/d/1UKQsIXq2HX4U8VMetAOq5HG7S9THCsGd/view',
        '11Hjlv0bJD6-fcDSeCGk4hzGd2HSWXpPO', 'https://drive.google.com/file/d/11Hjlv0bJD6-fcDSeCGk4hzGd2HSWXpPO/view',
        1, '2026-06-01T12:14:51Z',
        '{"iptu_cents": 9292, "iptu_installment": "1/6", "lixo_cents": 4364, "lixo_installment": "1/3"}'::jsonb
    ),
    (
        v_iptu_id, '2026-06', 'PAID_RECONCILED', 13656, '2026-06-30',
        '1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab', 'https://drive.google.com/file/d/1yVcJG1f_lqYJJGjo4TLxmXZ0qKJp5Cab/view',
        '1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z', 'https://drive.google.com/file/d/1mWvSW4Wvf9tHGZOAQa_Txf3KSQXHOi5Z/view',
        1, '2026-06-30T18:15:21Z',
        '{"iptu_cents": 9292, "iptu_installment": "2/6", "lixo_cents": 4364, "lixo_installment": "2/3"}'::jsonb
    ),
    (
        v_iptu_id, '2026-07', 'PAID_RECONCILED', 13656, '2026-07-30',
        '1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o', 'https://drive.google.com/file/d/1qAA0S9PSO58fBVh2B3tcnnDObmHNDS8o/view',
        '1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv', 'https://drive.google.com/file/d/1zFEOke-sa4og8HZlEnkUZE_tjcAtOafv/view',
        1, '2026-07-30T19:55:44Z',
        '{"iptu_cents": 9292, "iptu_installment": "3/6", "lixo_cents": 4364, "lixo_installment": "3/3 (Finalizada)"}'::jsonb
    ),
    (
        v_iptu_id, '2026-08', 'PAID_RECONCILED', 9292, '2026-08-30',
        '10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY', 'https://drive.google.com/file/d/10ygLtGIMyzoTZQEfTCIAVFdzheRK0GpY/view',
        NULL, NULL,
        1, '2026-08-30T22:08:58Z',
        '{"iptu_cents": 9292, "iptu_installment": "4/6", "lixo_cents": 0, "note": "Taxa de lixo encerrada na parcela 3/3 em Julho (-R$ 43,64/mês)"}'::jsonb
    )
    ON CONFLICT (provider_id, reference_month) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        due_date = EXCLUDED.due_date,
        invoice_drive_file_id = EXCLUDED.invoice_drive_file_id,
        invoice_drive_url = EXCLUDED.invoice_drive_url,
        receipt_drive_file_id = EXCLUDED.receipt_drive_file_id,
        receipt_drive_url = EXCLUDED.receipt_drive_url,
        paid_at = EXCLUDED.paid_at,
        bi_metadata = EXCLUDED.bi_metadata;
END $$;
