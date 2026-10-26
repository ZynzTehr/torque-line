// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/data/templates.js.
// Industry-standard starting intervals; owners adjust them per unit.
import type { EquipmentType, PmCategory } from "./types";

export interface TemplateItem {
  name: string;
  category: PmCategory;
  mileageInterval: number | null;
  timeInterval: number | null;
  description: string;
}

export const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: 'tractor', label: 'Tractor' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'reefer', label: 'Reefer Trailer' },
];

/**
 * Each template item:
 *   name       – human-readable service name
 *   category   – PM-A / PM-B / PM-C / Annual / Custom
 *   mileageInterval – miles between services (null = time-only)
 *   timeInterval    – days between services (null = mileage-only)
 *   description     – what the service covers
 */

export const DEFAULT_TEMPLATES: Record<EquipmentType, TemplateItem[]> = {
  tractor: [
    {
      name: 'Oil & Filter Change',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'Engine oil + filter change, chassis lube, fluid top-off',
    },
    {
      name: 'Air Filter Inspection',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'Check and replace air filter if needed',
    },
    {
      name: 'Coolant Level Check',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'Check coolant condition and level, top off',
    },
    {
      name: 'Fuel Filter Replacement',
      category: 'PM-B',
      mileageInterval: 30000,
      timeInterval: 180,
      description: 'Primary and secondary fuel filter replacement',
    },
    {
      name: 'Brake Adjustment & Inspection',
      category: 'PM-B',
      mileageInterval: 30000,
      timeInterval: 180,
      description: 'Brake adjustment, drum/rotor inspection, pad/shoe thickness',
    },
    {
      name: 'Battery & Electrical Test',
      category: 'PM-B',
      mileageInterval: 30000,
      timeInterval: 180,
      description: 'Battery load test, alternator output, wiring check',
    },
    {
      name: 'Belts & Hoses Inspection',
      category: 'PM-B',
      mileageInterval: 30000,
      timeInterval: 180,
      description: 'Serpentine belt, radiator hoses, clamps',
    },
    {
      name: 'Transmission Fluid Service',
      category: 'PM-C',
      mileageInterval: 100000,
      timeInterval: 365,
      description: 'Transmission fluid and filter change',
    },
    {
      name: 'Differential Fluid Service',
      category: 'PM-C',
      mileageInterval: 100000,
      timeInterval: 365,
      description: 'Rear differential fluid change',
    },
    {
      name: 'Coolant System Flush',
      category: 'PM-C',
      mileageInterval: 150000,
      timeInterval: 730,
      description: 'Full coolant system flush and refill',
    },
    {
      name: 'Valve Adjustment',
      category: 'PM-C',
      mileageInterval: 150000,
      timeInterval: 730,
      description: 'Engine valve lash adjustment',
    },
    {
      name: 'Wheel Alignment',
      category: 'PM-C',
      mileageInterval: 100000,
      timeInterval: 365,
      description: 'Front and rear alignment check and adjustment',
    },
    {
      name: 'DOT Annual Inspection',
      category: 'Annual',
      mileageInterval: null,
      timeInterval: 365,
      description: 'Mandatory FMCSA annual inspection — all safety systems',
    },
  ],

  trailer: [
    {
      name: 'Brake Adjustment',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'Brake adjustment and shoe/pad inspection',
    },
    {
      name: 'Tire Inspection',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'Tread depth, inflation, sidewall damage',
    },
    {
      name: 'Lights & Reflectors',
      category: 'PM-A',
      mileageInterval: 15000,
      timeInterval: 90,
      description: 'All marker lights, brake lights, turn signals, reflectors',
    },
    {
      name: 'Landing Gear & Kingpin',
      category: 'PM-B',
      mileageInterval: 45000,
      timeInterval: 180,
      description: 'Landing gear operation, kingpin wear measurement',
    },
    {
      name: 'Suspension Inspection',
      category: 'PM-B',
      mileageInterval: 45000,
      timeInterval: 180,
      description: 'Air bags, springs, hangers, bushings',
    },
    {
      name: 'Floor Inspection',
      category: 'PM-B',
      mileageInterval: 45000,
      timeInterval: 180,
      description: 'Trailer floor condition, crossmembers',
    },
    {
      name: 'Wheel Seal & Bearing',
      category: 'PM-C',
      mileageInterval: 100000,
      timeInterval: 365,
      description: 'Wheel seal replacement, bearing repack/inspect',
    },
    {
      name: 'DOT Annual Inspection',
      category: 'Annual',
      mileageInterval: null,
      timeInterval: 365,
      description: 'Mandatory FMCSA annual inspection — all safety systems',
    },
  ],

  reefer: [
    {
      name: 'Reefer Oil & Filter',
      category: 'PM-A',
      mileageInterval: null,
      timeInterval: 90,
      description: 'Reefer unit engine oil and filter change',
    },
    {
      name: 'Belts Inspection',
      category: 'PM-A',
      mileageInterval: null,
      timeInterval: 90,
      description: 'Drive belt tension and condition',
    },
    {
      name: 'Condenser & Evaporator Clean',
      category: 'PM-B',
      mileageInterval: null,
      timeInterval: 180,
      description: 'Clean condenser and evaporator coils',
    },
    {
      name: 'Refrigerant Check',
      category: 'PM-B',
      mileageInterval: null,
      timeInterval: 180,
      description: 'Refrigerant level check and leak inspection',
    },
    {
      name: 'Fuel System Service',
      category: 'PM-B',
      mileageInterval: null,
      timeInterval: 180,
      description: 'Fuel filter, injectors, fuel lines',
    },
    {
      name: 'Compressor Service',
      category: 'PM-C',
      mileageInterval: null,
      timeInterval: 365,
      description: 'Compressor oil, valves, gaskets',
    },
    {
      name: 'Electrical System Check',
      category: 'PM-C',
      mileageInterval: null,
      timeInterval: 365,
      description: 'Thermostat calibration, sensors, wiring, controller',
    },
    {
      name: 'DOT Annual Inspection',
      category: 'Annual',
      mileageInterval: null,
      timeInterval: 365,
      description: 'Mandatory FMCSA annual inspection',
    },
  ],
};

/**
 * Returns the default PM items for a given equipment type.
 * Each item gets an equipmentId assigned when created.
 */

/** Fresh copies of the default schedule for a unit type, with no service baseline yet. */
export function getDefaultMaintenanceItems(type: EquipmentType) {
  return (DEFAULT_TEMPLATES[type] ?? []).map((t) => ({ ...t, enabled: true, lastServiceMileage: null, lastServiceDate: null }));
}
