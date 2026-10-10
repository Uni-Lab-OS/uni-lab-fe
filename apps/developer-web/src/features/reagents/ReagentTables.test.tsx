import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Reagent, ReagentInfo } from '@unilab-fe/core'
import { CatalogTable, InventoryTable, listPagination } from './ReagentTables'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
})

const info: ReagentInfo = {
  kind: 'reagent_info',
  source: 'os',
  reagentInfoUuid: 'info-1',
  name: '乙醇',
  nameEn: 'Ethanol',
  aliases: [],
  cas: '64-17-5',
  molecularFormula: 'C2H6O',
  smiles: null,
  inchiKey: null,
  molecularWeight: 46.07,
  densityGPerMl: 0.789,
  physicalState: 'liquid',
  description: null,
  metadata: {},
  createdAt: null,
  updatedAt: null,
  raw: {},
}

const reagent: Reagent = {
  kind: 'reagent',
  source: 'os',
  reagentUuid: 'reagent-1',
  materialUuid: 'material-1',
  reagentInfoUuid: info.reagentInfoUuid,
  name: info.name,
  nameEn: info.nameEn,
  cas: info.cas,
  molecularFormula: info.molecularFormula,
  physicalState: 'liquid',
  quantity: 500,
  quantityUnit: 'mL',
  reservedQuantity: 0,
  concentrationValue: null,
  concentrationUnit: null,
  densityGPerMl: 0.789,
  densitySource: 'dictionary',
  revision: 1,
  materialRevision: 1,
  containerBarcode: 'B-1',
  containerName: '瓶 1',
  maximumCapacity: { maxVolumeUl: 1_000_000, maxMassG: null, raw: {} },
  configuredCapacity: null,
  ratedCapacity: null,
  reagentInfo: info,
  description: null,
  metadata: {},
  createdAt: null,
  updatedAt: null,
  status: 'available',
  raw: {},
}

describe('reagent table capability boundaries', () => {
  it('disables every inventory mutation when the endpoint denies capabilities', () => {
    const onHistory = vi.fn()
    const onEdit = vi.fn()
    const onDispense = vi.fn()
    const onDelete = vi.fn()
    render(
      <InventoryTable
        data={[reagent]}
        page={1}
        total={1}
        onPageChange={vi.fn()}
        canMutate={false}
        canDelete={false}
        canDispense={false}
        onHistory={onHistory}
        canReadHistory={false}
        onEdit={onEdit}
        onDispense={onDispense}
        onDelete={onDelete}
      />,
    )

    const row = screen.getByRole('row', { name: /乙醇/ })
    const buttons = within(row).getAllByRole('button')
    expect(buttons).toHaveLength(4)
    expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    buttons.forEach((button) => fireEvent.click(button))
    expect(onHistory).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
    expect(onDispense).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('routes enabled inventory operations to their domain callbacks', () => {
    const handlers = {
      onHistory: vi.fn(),
      onEdit: vi.fn(),
      onDispense: vi.fn(),
      onDelete: vi.fn(),
    }
    render(
      <InventoryTable
        data={[reagent]}
        page={1}
        total={1}
        onPageChange={vi.fn()}
        canMutate
        canDelete
        canDispense
        {...handlers}
        canReadHistory
      />,
    )

    const buttons = within(screen.getByRole('row', { name: /乙醇/ })).getAllByRole('button')
    buttons.forEach((button) => expect(button).toBeEnabled())
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    fireEvent.click(buttons[2])
    fireEvent.click(buttons[3])
    expect(handlers.onHistory).toHaveBeenCalledWith(reagent)
    expect(handlers.onDispense).toHaveBeenCalledWith(reagent)
    expect(handlers.onEdit).toHaveBeenCalledWith(reagent)
    expect(handlers.onDelete).toHaveBeenCalledWith(reagent)
  })

  it('keeps catalog detail readable while disabling denied writes', () => {
    const onDetail = vi.fn()
    const onEdit = vi.fn()
    const onCreateInventory = vi.fn()
    const onDelete = vi.fn()
    render(
      <CatalogTable
        data={[info]}
        page={1}
        total={1}
        onPageChange={vi.fn()}
        canMutate={false}
        canEdit={false}
        canDelete={false}
        onDetail={onDetail}
        onEdit={onEdit}
        onCreateInventory={onCreateInventory}
        onDelete={onDelete}
      />,
    )

    const row = screen.getByRole('row', { name: /乙醇/ })
    const buttons = within(row).getAllByRole('button')
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toBeEnabled()
    expect(buttons.slice(1).every((button) => button.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(buttons[0])
    expect(onDetail).toHaveBeenCalledWith(info)
    expect(onEdit).not.toHaveBeenCalled()
    expect(onCreateInventory).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('exposes stable pagination labels and forwards page changes', () => {
    const onChange = vi.fn()
    const pagination = listPagination(2, 21, onChange)
    expect(pagination.current).toBe(2)
    expect(pagination.pageSize).toBe(10)
    expect(pagination.showTotal?.(21, [11, 20])).toBe('11-20 / 共 21 条')
    expect(pagination.showTotal?.(0, [0, 0])).toBe('共 0 条')
    pagination.onChange?.(3)
    expect(onChange).toHaveBeenCalledWith(3)
  })
})
