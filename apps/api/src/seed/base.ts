import { DEFAULT_MX_CALENDAR, DEFAULT_ROLES, STANDARD_PLAN_TARGETS } from '@inn/shared';
import type { PrismaClient } from '@prisma/client';

/** Reference data required by the application (idempotent). Demo data lives in prisma/seed.ts. */
export async function seedBase(prisma: PrismaClient): Promise<void> {
  for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
    await prisma.role.upsert({
      where: { name },
      update: { permissions, builtIn: true },
      create: { name, permissions, builtIn: true },
    });
  }

  const states: Array<[string, string, boolean]> = [
    ['new', 'open', false],
    ['open', 'open', false],
    ['pending_reminder', 'pending', true],
    ['pending_close', 'pending', true],
    ['resolved', 'closed', false],
    ['closed', 'closed', false],
    ['merged', 'merged', false],
  ];
  for (const [name, category, isPending] of states) {
    await prisma.ticketState.upsert({
      where: { name },
      update: {},
      create: { name, category, isPending },
    });
  }
  const priorities: Array<[number, string]> = [
    [1, '1 baja'],
    [2, '2 normal'],
    [3, '3 alta'],
    [4, '4 crítica'],
  ];
  for (const [value, name] of priorities) {
    await prisma.ticketPriority.upsert({ where: { value }, update: {}, create: { value, name } });
  }

  for (const name of ['Soporte N1', 'Soporte N2', 'Soporte N3', 'Implementación', 'Facturación']) {
    await prisma.group.upsert({ where: { name }, update: {}, create: { name } });
  }
  await prisma.group.upsert({
    where: { name: 'Por verificar' },
    update: { isVerification: true },
    create: { name: 'Por verificar', isVerification: true },
  });

  const calendar = await prisma.businessCalendar.upsert({
    where: { name: DEFAULT_MX_CALENDAR.name },
    update: {},
    create: { name: DEFAULT_MX_CALENDAR.name, config: DEFAULT_MX_CALENDAR, isDefault: true },
  });
  const plan = await prisma.supportPlan.upsert({
    where: { name: 'Estándar' },
    update: {},
    create: { name: 'Estándar', includedHoursMonthly: 10 },
  });
  await prisma.sla.upsert({
    where: { name: 'Estándar' },
    update: {},
    create: {
      name: 'Estándar',
      condition: { 'organization.support_plan_id': { operator: 'is', value: [plan.id] } },
      targets: STANDARD_PLAN_TARGETS,
      calendarId: calendar.id,
      supportPlanId: plan.id,
    },
  });

  for (const name of ['Análisis', 'Configuración', 'Capacitación', 'Llamada', 'Desarrollo']) {
    await prisma.timeActivityType.upsert({ where: { name }, update: {}, create: { name } });
  }

  const select = (values: string[]) => ({ options: values.map((v) => ({ value: v, label: v })) });
  const attributes: Array<{
    name: string;
    display: Record<string, string>;
    dataType: string;
    options: object;
    customerVisible: boolean;
  }> = [
    {
      name: 'inncentives_environment',
      display: { 'es-MX': 'Ambiente', en: 'Environment' },
      dataType: 'select',
      options: select(['Dev', 'QA', 'Prod']),
      customerVisible: true,
    },
    {
      name: 'inncentives_module',
      display: { 'es-MX': 'Módulo de Inncentives', en: 'Inncentives module' },
      dataType: 'select',
      options: select([
        'Organización',
        'Beneficiarios',
        'Tablas dinámicas',
        'Carga de datos',
        'Calendarios',
        'Planes de compensación',
        'Procesos calendarizados',
        'Flujos',
        'Reportes',
        'Portal',
        'Centro de Comando',
        'Seguridad/Usuarios',
        'API',
        'Otro',
      ]),
      customerVisible: true,
    },
    {
      name: 'category',
      display: { 'es-MX': 'Categoría', en: 'Category' },
      dataType: 'select',
      options: select([
        'Incidente',
        'Duda de uso',
        'Solicitud de cambio',
        'Error en cálculo',
        'Carga de datos',
        'Acceso/usuarios',
        'Facturación',
      ]),
      customerVisible: true,
    },
    {
      name: 'impact',
      display: { 'es-MX': 'Impacto', en: 'Impact' },
      dataType: 'select',
      options: select(['Bloquea la operación', 'Afecta parcialmente', 'Sin impacto inmediato']),
      customerVisible: true,
    },
    {
      name: 'inncentives_version',
      display: { 'es-MX': 'Versión de Inncentives', en: 'Inncentives version' },
      dataType: 'input',
      options: {},
      customerVisible: true,
    },
    {
      name: 'plan_name',
      display: { 'es-MX': 'Plan de compensación', en: 'Compensation plan' },
      dataType: 'input',
      options: {},
      customerVisible: true,
    },
    {
      name: 'process_execution_id',
      display: { 'es-MX': 'ID de ejecución', en: 'Execution ID' },
      dataType: 'input',
      options: {},
      customerVisible: true,
    },
  ];
  for (const [position, a] of attributes.entries()) {
    await prisma.objectAttribute.upsert({
      where: { object_name: { object: 'Ticket', name: a.name } },
      update: {},
      create: { object: 'Ticket', builtIn: true, position, ...a },
    });
  }
}
