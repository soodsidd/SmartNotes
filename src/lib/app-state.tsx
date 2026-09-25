'use client'

import * as React from 'react'
import {
  mockNotebooks,
  mockAiThreads,
  type Notebook,
  type Section,
  type Page,
  type AiMessage,
} from './mock-data'

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileView = 'notebooks' | 'sections' | 'pages' | 'editor' | 'capture' | 'search' | 'ai'

export interface AppState {
  // Data (mutable in-memory only)
  notebooks: Notebook[]

  // Selection
  activeNotebookId: string | null
  activeSectionId: string | null
  activePageId: string | null

  // UI state
  sidebarCollapsed: boolean
  aiPanelOpen: boolean
  mobileView: MobileView
  mobileTab: 'notes' | 'capture' | 'search' | 'ai'

  // Expanded tree nodes
  expandedNotebooks: Set<string>
  expandedSections: Set<string>

  // AI threads
  aiThreads: Record<string, AiMessage[]>

  // Overlays
  captureModalOpen: boolean
  searchModalOpen: boolean
  settingsOpen: boolean
  diffReviewOpen: boolean
}

export interface AppActions {
  // Navigation
  selectPage: (notebookId: string, sectionId: string, pageId: string) => void
  selectSection: (notebookId: string, sectionId: string) => void
  selectNotebook: (notebookId: string) => void
  toggleNotebook: (notebookId: string) => void
  toggleSection: (sectionId: string) => void
  goBack: () => void
  setMobileTab: (tab: AppState['mobileTab']) => void

  // Sidebar
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setAiPanelOpen: (v: boolean) => void
  toggleAiPanel: () => void

  // Overlays
  setCaptureModalOpen: (v: boolean) => void
  setSearchModalOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setDiffReviewOpen: (v: boolean) => void

  // CRUD (in-memory)
  createNotebook: (name: string, color: string) => void
  createSection: (notebookId: string, name: string) => void
  createPage: (notebookId: string, sectionId: string, title: string) => void
  renameNotebook: (notebookId: string, name: string) => void
  renameSection: (notebookId: string, sectionId: string, name: string) => void
  renamePage: (notebookId: string, sectionId: string, pageId: string, title: string) => void
  deleteNotebook: (notebookId: string) => void
  deleteSection: (notebookId: string, sectionId: string) => void
  deletePage: (notebookId: string, sectionId: string, pageId: string) => void
  setNotebookColor: (notebookId: string, color: string) => void
  updatePageContent: (pageId: string, content: string) => void

  // AI
  sendAiMessage: (pageId: string, content: string) => void

  // Getters
  getActiveNotebook: () => Notebook | undefined
  getActiveSection: () => Section | undefined
  getActivePage: () => Page | undefined
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = React.createContext<(AppState & AppActions) | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

let idCounter = 1000
function genId(prefix: string) {
  return `${prefix}-${++idCounter}`
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [notebooks, setNotebooks] = React.useState<Notebook[]>(mockNotebooks)
  const [activeNotebookId, setActiveNotebookId] = React.useState<string | null>(
    mockNotebooks[0]?.id ?? null
  )
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(
    mockNotebooks[0]?.sections[0]?.id ?? null
  )
  const [activePageId, setActivePageId] = React.useState<string | null>(
    mockNotebooks[0]?.sections[0]?.pages[0]?.id ?? null
  )
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [aiPanelOpen, setAiPanelOpen] = React.useState(true)
  const [mobileView, setMobileView] = React.useState<MobileView>('notebooks')
  const [mobileTab, setMobileTab] = React.useState<AppState['mobileTab']>('notes')
  const [expandedNotebooks, setExpandedNotebooks] = React.useState<Set<string>>(
    new Set([mockNotebooks[0]?.id ?? ''])
  )
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(
    new Set([mockNotebooks[0]?.sections[0]?.id ?? ''])
  )
  const [aiThreads, setAiThreads] = React.useState<Record<string, AiMessage[]>>(mockAiThreads)

  const [captureModalOpen, setCaptureModalOpen] = React.useState(false)
  const [searchModalOpen, setSearchModalOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [diffReviewOpen, setDiffReviewOpen] = React.useState(false)

  // ─── Navigation ────────────────────────────────────────────────────────────

  const selectPage = React.useCallback(
    (notebookId: string, sectionId: string, pageId: string) => {
      setActiveNotebookId(notebookId)
      setActiveSectionId(sectionId)
      setActivePageId(pageId)
      setExpandedNotebooks((prev) => new Set([...prev, notebookId]))
      setExpandedSections((prev) => new Set([...prev, sectionId]))
      setMobileView('editor')
    },
    []
  )

  const selectSection = React.useCallback((notebookId: string, sectionId: string) => {
    setActiveNotebookId(notebookId)
    setActiveSectionId(sectionId)
    setMobileView('pages')
  }, [])

  const selectNotebook = React.useCallback((notebookId: string) => {
    setActiveNotebookId(notebookId)
    setMobileView('sections')
  }, [])

  const toggleNotebook = React.useCallback((notebookId: string) => {
    setExpandedNotebooks((prev) => {
      const next = new Set(prev)
      if (next.has(notebookId)) {
        next.delete(notebookId)
      } else {
        next.add(notebookId)
      }
      return next
    })
  }, [])

  const toggleSection = React.useCallback((sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }, [])

  const goBack = React.useCallback(() => {
    setMobileView((prev) => {
      if (prev === 'editor') return 'pages'
      if (prev === 'pages') return 'sections'
      if (prev === 'sections') return 'notebooks'
      return 'notebooks'
    })
  }, [])

  const handleSetMobileTab = React.useCallback((tab: AppState['mobileTab']) => {
    setMobileTab(tab)
    if (tab === 'notes') setMobileView('notebooks')
    if (tab === 'capture') setCaptureModalOpen(true)
    if (tab === 'search') setSearchModalOpen(true)
    if (tab === 'ai') {
      // AI handled by sheet in editor view
    }
  }, [])

  // ─── UI ────────────────────────────────────────────────────────────────────

  const toggleSidebar = React.useCallback(() => setSidebarCollapsed((v) => !v), [])
  const toggleAiPanel = React.useCallback(() => setAiPanelOpen((v) => !v), [])

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  const createNotebook = React.useCallback((name: string, color: string) => {
    const id = genId('nb')
    const sectionId = genId('sec')
    const pageId = genId('pg')
    const now = new Date().toISOString()
    setNotebooks((prev) => [
      ...prev,
      {
        id,
        name,
        color,
        sections: [
          {
            id: sectionId,
            name: 'General',
            pages: [
              {
                id: pageId,
                title: 'Untitled',
                slug: 'untitled',
                updatedAt: now,
                createdAt: now,
                preview: '',
                content: '# Untitled\n\nStart writing here.',
              },
            ],
          },
        ],
      },
    ])
    setExpandedNotebooks((prev) => new Set([...prev, id]))
  }, [])

  const createSection = React.useCallback((notebookId: string, name: string) => {
    const id = genId('sec')
    const pageId = genId('pg')
    const now = new Date().toISOString()
    setNotebooks((prev) =>
      prev.map((nb) =>
        nb.id !== notebookId
          ? nb
          : {
              ...nb,
              sections: [
                ...nb.sections,
                {
                  id,
                  name,
                  pages: [
                    {
                      id: pageId,
                      title: 'Untitled',
                      slug: 'untitled',
                      updatedAt: now,
                      createdAt: now,
                      preview: '',
                      content: '# Untitled\n\nStart writing here.',
                    },
                  ],
                },
              ],
            }
      )
    )
    setExpandedSections((prev) => new Set([...prev, id]))
  }, [])

  const createPage = React.useCallback(
    (notebookId: string, sectionId: string, title: string) => {
      const id = genId('pg')
      const now = new Date().toISOString()
      setNotebooks((prev) =>
        prev.map((nb) =>
          nb.id !== notebookId
            ? nb
            : {
                ...nb,
                sections: nb.sections.map((sec) =>
                  sec.id !== sectionId
                    ? sec
                    : {
                        ...sec,
                        pages: [
                          ...sec.pages,
                          {
                            id,
                            title,
                            slug: title.toLowerCase().replace(/\s+/g, '-'),
                            updatedAt: now,
                            createdAt: now,
                            preview: '',
                            content: `# ${title}\n\nStart writing here.`,
                          },
                        ],
                      }
                ),
              }
        )
      )
      setActivePageId(id)
      setActiveSectionId(sectionId)
      setActiveNotebookId(notebookId)
      setMobileView('editor')
    },
    []
  )

  const renameNotebook = React.useCallback((notebookId: string, name: string) => {
    setNotebooks((prev) =>
      prev.map((nb) => (nb.id === notebookId ? { ...nb, name } : nb))
    )
  }, [])

  const renameSection = React.useCallback(
    (notebookId: string, sectionId: string, name: string) => {
      setNotebooks((prev) =>
        prev.map((nb) =>
          nb.id !== notebookId
            ? nb
            : {
                ...nb,
                sections: nb.sections.map((sec) =>
                  sec.id === sectionId ? { ...sec, name } : sec
                ),
              }
        )
      )
    },
    []
  )

  const renamePage = React.useCallback(
    (notebookId: string, sectionId: string, pageId: string, title: string) => {
      setNotebooks((prev) =>
        prev.map((nb) =>
          nb.id !== notebookId
            ? nb
            : {
                ...nb,
                sections: nb.sections.map((sec) =>
                  sec.id !== sectionId
                    ? sec
                    : {
                        ...sec,
                        pages: sec.pages.map((pg) =>
                          pg.id === pageId ? { ...pg, title } : pg
                        ),
                      }
                ),
              }
        )
      )
    },
    []
  )

  const deleteNotebook = React.useCallback((notebookId: string) => {
    setNotebooks((prev) => prev.filter((nb) => nb.id !== notebookId))
    setActiveNotebookId((prev) => (prev === notebookId ? null : prev))
  }, [])

  const deleteSection = React.useCallback(
    (notebookId: string, sectionId: string) => {
      setNotebooks((prev) =>
        prev.map((nb) =>
          nb.id !== notebookId
            ? nb
            : { ...nb, sections: nb.sections.filter((sec) => sec.id !== sectionId) }
        )
      )
      setActiveSectionId((prev) => (prev === sectionId ? null : prev))
    },
    []
  )

  const deletePage = React.useCallback(
    (notebookId: string, sectionId: string, pageId: string) => {
      setNotebooks((prev) =>
        prev.map((nb) =>
          nb.id !== notebookId
            ? nb
            : {
                ...nb,
                sections: nb.sections.map((sec) =>
                  sec.id !== sectionId
                    ? sec
                    : { ...sec, pages: sec.pages.filter((pg) => pg.id !== pageId) }
                ),
              }
        )
      )
      setActivePageId((prev) => (prev === pageId ? null : prev))
    },
    []
  )

  const setNotebookColor = React.useCallback((notebookId: string, color: string) => {
    setNotebooks((prev) =>
      prev.map((nb) => (nb.id === notebookId ? { ...nb, color } : nb))
    )
  }, [])

  const updatePageContent = React.useCallback((pageId: string, content: string) => {
    const now = new Date().toISOString()
    setNotebooks((prev) =>
      prev.map((nb) => ({
        ...nb,
        sections: nb.sections.map((sec) => ({
          ...sec,
          pages: sec.pages.map((pg) =>
            pg.id === pageId ? { ...pg, content, updatedAt: now } : pg
          ),
        })),
      }))
    )
  }, [])

  // ─── AI ────────────────────────────────────────────────────────────────────

  const MOCK_AI_RESPONSES = [
    "That's an interesting question about this note. Based on the content, I can see several key themes worth exploring further. The structure is well-organized and the technical details are accurate. Would you like me to expand on any particular section?",
    "Looking at this page, I notice the information could benefit from additional context. The main concepts are clearly presented, but a few supporting examples would strengthen the argument. I can draft an addition if you'd like.",
    "Great question! This connects to several related topics in your Research notebook. The core idea here is sound — the mathematical treatment is correct and the experimental methodology is well-documented. One thing to consider: the measurement uncertainty isn't discussed. Want me to add a section on that?",
    "I've analyzed the content of this page carefully. The writing is clear and the technical accuracy is high. I'd suggest restructuring the 'Key Finding' section to lead with the quantitative result before the qualitative interpretation — it makes the takeaway more immediate for readers scanning quickly.",
  ]

  const sendAiMessage = React.useCallback((pageId: string, content: string) => {
    const now = new Date().toISOString()
    const userMsg: AiMessage = {
      id: genId('msg'),
      role: 'user',
      content,
      timestamp: now,
    }
    const aiMsg: AiMessage = {
      id: genId('msg'),
      role: 'assistant',
      content:
        MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)],
      timestamp: new Date(Date.now() + 1000).toISOString(),
    }
    setAiThreads((prev) => ({
      ...prev,
      [pageId]: [...(prev[pageId] ?? []), userMsg, aiMsg],
    }))
  }, [])

  // ─── Getters ───────────────────────────────────────────────────────────────

  const getActiveNotebook = React.useCallback(
    () => notebooks.find((nb) => nb.id === activeNotebookId),
    [notebooks, activeNotebookId]
  )

  const getActiveSection = React.useCallback(() => {
    const nb = notebooks.find((n) => n.id === activeNotebookId)
    return nb?.sections.find((s) => s.id === activeSectionId)
  }, [notebooks, activeNotebookId, activeSectionId])

  const getActivePage = React.useCallback(() => {
    const nb = notebooks.find((n) => n.id === activeNotebookId)
    const sec = nb?.sections.find((s) => s.id === activeSectionId)
    return sec?.pages.find((p) => p.id === activePageId)
  }, [notebooks, activeNotebookId, activeSectionId, activePageId])

  const value: AppState & AppActions = {
    notebooks,
    activeNotebookId,
    activeSectionId,
    activePageId,
    sidebarCollapsed,
    aiPanelOpen,
    mobileView,
    mobileTab,
    expandedNotebooks,
    expandedSections,
    aiThreads,
    captureModalOpen,
    searchModalOpen,
    settingsOpen,
    diffReviewOpen,

    selectPage,
    selectSection,
    selectNotebook,
    toggleNotebook,
    toggleSection,
    goBack,
    setMobileTab: handleSetMobileTab,
    setSidebarCollapsed,
    toggleSidebar,
    setAiPanelOpen,
    toggleAiPanel,
    setCaptureModalOpen,
    setSearchModalOpen,
    setSettingsOpen,
    setDiffReviewOpen,
    createNotebook,
    createSection,
    createPage,
    renameNotebook,
    renameSection,
    renamePage,
    deleteNotebook,
    deleteSection,
    deletePage,
    setNotebookColor,
    updatePageContent,
    sendAiMessage,
    getActiveNotebook,
    getActiveSection,
    getActivePage,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useApp() {
  const ctx = React.useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
