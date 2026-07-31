import {
  createContext,
  useContext,
  useRef,
  type ReactNode
} from 'react'

interface WorkflowSessionStore {
  read: <Snapshot>(key: string) => Snapshot | null
  write: <Snapshot>(key: string, snapshot: Snapshot) => void
}

const WorkflowSessionContext =
  createContext<WorkflowSessionStore | null>(null)

export function WorkflowSessionProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const sessions = useRef(new Map<string, unknown>())
  const store = useRef<WorkflowSessionStore | null>(null)

  if (!store.current) {
    store.current = {
      read: <Snapshot,>(key: string): Snapshot | null =>
        (sessions.current.get(key) as Snapshot | undefined) ?? null,
      write: <Snapshot,>(key: string, snapshot: Snapshot): void => {
        sessions.current.set(key, snapshot)
      }
    }
  }

  return (
    <WorkflowSessionContext.Provider value={store.current}>
      {children}
    </WorkflowSessionContext.Provider>
  )
}

export function useWorkflowSessionStore(): WorkflowSessionStore | null {
  return useContext(WorkflowSessionContext)
}
