import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const DEFAULT_SECTION_CONFIG = {
  playingCards: {
    label: 'Playing Cards',
    type: 'playingCard',
    fields: ['name', 'image', 'description'],
  },
  powerups: {
    label: 'Powerups',
    type: 'powerup',
    fields: ['name', 'image', 'description'],
  },
  currency: {
    label: 'Currency',
    type: 'currency',
    fields: ['name', 'image', 'description'],
  },
  joker: {
    label: 'Joker',
    type: 'joker',
    fields: ['name', 'image', 'description', 'requiredPowerups', 'howToObtain'],
  },
  ace: {
    label: 'Ace',
    type: 'ace',
    fields: ['name', 'image', 'description'],
  },
  fate: {
    label: 'Fate',
    type: 'fate',
    fields: ['name', 'image', 'description'],
  },
  minigame: {
    label: 'Minigame',
    type: 'minigame',
    fields: ['name', 'image', 'description'],
  },
  prestige: {
    label: 'Prestige Achievements',
    type: 'prestige',
    fields: ['name', 'image', 'description', 'requirement', 'buff'],
  },
  challenges: {
    label: 'Challenges',
    type: 'challenge',
    fields: ['name', 'image', 'description', 'completeRules'],
  },
  trophies: {
    label: 'Trophies',
    type: 'trophy',
    fields: ['name', 'image', 'description', 'requirement', 'buff'],
  },
}

const normalizeCategoryKey = (label) => {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')

  return normalized || ''
}

const initialCatalog = {
  playingCards: [
    {
      id: 'pc-royal-red',
      name: 'Royal Red',
      image: 'A♠',
      description: 'Playing Card',
      section: 'playingCards',
      type: 'playingCard',
      tint: 'card-red',
    },
    {
      id: 'pc-midnight-black',
      name: 'Midnight Black',
      image: 'K♥',
      description: 'Playing Card',
      section: 'playingCards',
      type: 'playingCard',
      tint: 'card-black',
    },
  ],
  powerups: [
    {
      id: 'pu-royal-swap',
      name: 'Royal Swap',
      image: '⚡',
      description: 'Reorders the top two cards and keeps a lucky spread on the table.',
      section: 'powerups',
      type: 'powerup',
      tint: 'gold',
    },
    {
      id: 'pu-vault-glow',
      name: 'Vault Glow',
      image: '✦',
      description: 'Adds a shimmer to the next hand and reveals a safe card target.',
      section: 'powerups',
      type: 'powerup',
      tint: 'amber',
    },
  ],
  currency: [
    {
      id: 'cur-coin',
      name: 'SpadeZ Coin',
      image: '◈',
      description: 'Currency',
      section: 'currency',
      type: 'currency',
      tint: 'gold',
    },
    {
      id: 'cur-bonus',
      name: 'Lucky Chips',
      image: '◆',
      description: 'Currency',
      section: 'currency',
      type: 'currency',
      tint: 'silver',
    },
  ],
  joker: [
    {
      id: 'jk-archivist',
      name: 'Archivist Joker',
      image: '🃏',
      description: 'Turns every third hand into a full-stack reveal phase with a higher payout ceiling.',
      section: 'joker',
      type: 'joker',
      requiredPowerups: 'Royal Swap, Vault Glow',
      howToObtain: 'Complete the morning ledger challenge and buy the vault archive upgrade.',
      tint: 'joker',
    },
  ],
  ace: [
    {
      id: 'ace-crest',
      name: 'Ace Crest',
      image: 'A',
      description: 'An ace sigil that marks your best opening hand with a bright gold foil edge.',
      section: 'ace',
      type: 'ace',
      tint: 'gold',
    },
  ],
  fate: [
    {
      id: 'ft-thread',
      name: 'Fate Thread',
      image: '⟡',
      description: 'A red-thread charm that nudges the table luck meter during big-stakes rounds.',
      section: 'fate',
      type: 'fate',
      tint: 'rose',
    },
  ],
  minigame: [
    {
      id: 'mg-fortune',
      name: 'Fortune Loop',
      image: '▣',
      description: 'A quick draw event that stacks multiplier chips for a bonus round.',
      section: 'minigame',
      type: 'minigame',
      tint: 'mint',
    },
  ],
  prestige: [
    {
      id: 'pr-ace-legend',
      name: 'Ace Legend',
      image: '🏆',
      description: 'Reach 12 perfect-deal streaks in the tournament vault.',
      section: 'prestige',
      type: 'prestige',
      requirement: '12 perfect deal streaks',
      buff: '+18% payout multiplier for all premium tables.',
      tint: 'gold',
    },
  ],
  challenges: [
    {
      id: 'ch-royal-dozen',
      name: 'Royal Dozen',
      image: '✓',
      description: 'Complete a full hand of gold-suited face cards without risking a bust.',
      section: 'challenges',
      type: 'challenge',
      completeRules: 'Finish 12 rounds while keeping your score below 21 on every turn and using at least one Royal Swap powerup.',
      tint: 'amber',
    },
  ],
  trophies: [
    {
      id: 'tr-velvet',
      name: 'Velvet Vault Trophy',
      image: '🏅',
      description: 'Earned by clearing Elite vault mode in a single live run.',
      section: 'trophies',
      type: 'trophy',
      requirement: 'Complete Elite Vault mode',
      buff: '+12% table XP for all challenge queues.',
      tint: 'royal',
    },
  ],
}

const CHECKED_ITEMS_STORAGE_KEY = 'spadez-blackjack:checked-items'
const CHECKABLE_SECTIONS = new Set(['joker', 'ace', 'fate', 'minigame', 'challenges', 'trophies'])

const readCheckedItems = () => {
  try {
    const stored = window.localStorage.getItem(CHECKED_ITEMS_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

const emptyForm = {
  name: '',
  image: '✦',
  description: '',
  requirement: '',
  buff: '',
  requiredPowerups: '',
  howToObtain: '',
  completeRules: '',
}

const defaultDraft = (sectionKey, sectionConfig = DEFAULT_SECTION_CONFIG) => {
  const defaults = { section: sectionKey, type: sectionConfig[sectionKey].type || 'custom', tint: 'gold' }
  return { ...emptyForm, ...defaults }
}

const getSectionItems = (catalog, sectionKey) => catalog[sectionKey] ?? []

const asFilterableItems = (catalog, sectionList) =>
  sectionList.flatMap((sectionKey) =>
    getSectionItems(catalog, sectionKey).map((item) => ({ ...item, sectionKey })),
  )

const adminApiRequest = async (path, { token, ...options } = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || `Request to ${path} failed with HTTP ${response.status}.`)
  }

  return result
}

const uploadCatalogImage = async (file, token) => {
  return adminApiRequest('/api/catalog/image', {
    method: 'POST',
    token,
    headers: { 'Content-Type': file.type },
    body: file,
  })
}

const isImageSource = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }

  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')
}

function App() {
  const [sectionConfig, setSectionConfig] = useState(DEFAULT_SECTION_CONFIG)
  const [customLogo, setCustomLogo] = useState('')
  const logoInputRef = useRef(null)
  const [catalog, setCatalog] = useState(initialCatalog)
  const [checkedItems, setCheckedItems] = useState(readCheckedItems)
  const [catalogError, setCatalogError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSection, setActiveSection] = useState('all')
  const [selectedItem, setSelectedItem] = useState(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [loginError, setLoginError] = useState('')
  const [adminSession, setAdminSession] = useState(null)
  const [adminEntries, setAdminEntries] = useState([])
  const [adminManagerOpen, setAdminManagerOpen] = useState(false)
  const [adminManagerDraft, setAdminManagerDraft] = useState({ name: '', pin: '' })
  const [adminManagerError, setAdminManagerError] = useState('')
  const [categoryNameDrafts, setCategoryNameDrafts] = useState(() =>
    Object.fromEntries(
      Object.entries(DEFAULT_SECTION_CONFIG).map(([sectionKey, sectionMeta]) => [sectionKey, sectionMeta.label]),
    ),
  )
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryMessageTabs, setNewCategoryMessageTabs] = useState([])
  const [categoryManagerError, setCategoryManagerError] = useState('')
  const [formState, setFormState] = useState(null)
  const [activeMessageTab, setActiveMessageTab] = useState('')

  const sectionList = useMemo(() => Object.keys(sectionConfig), [sectionConfig])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHECKED_ITEMS_STORAGE_KEY, JSON.stringify([...checkedItems]))
    } catch {
      // Keep the current session usable when browser storage is unavailable.
    }
  }, [checkedItems])

  const toggleItemChecked = (sectionKey, itemId) => {
    const key = `${sectionKey}:${itemId}`
    setCheckedItems((current) => {
      const updated = new Set(current)
      if (updated.has(key)) updated.delete(key)
      else updated.add(key)
      return updated
    })
  }

  const persistSectionConfig = async (nextConfig) => {
    await adminApiRequest('/api/catalog/settings', {
      method: 'PATCH',
      token: adminSession?.token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionConfig: nextConfig }),
    })
    setSectionConfig(nextConfig)
  }

  const handleLogoUpload = (event) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      window.alert('Choose an image file for the logo.')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      window.alert('Choose a logo image smaller than 2 MB.')
      return
    }

    if (!adminSession?.token) return

    void (async () => {
      try {
        const { image } = await uploadCatalogImage(file, adminSession.token)
        await adminApiRequest('/api/catalog/settings', {
          method: 'PATCH',
          token: adminSession.token,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customLogo: image }),
        })
        setCustomLogo(image)
      } catch (error) {
        window.alert(error.message)
      }
    })()
  }

  const handleRenameCategory = async (sectionKey) => {
    const nextLabel = (categoryNameDrafts[sectionKey] ?? sectionConfig[sectionKey].label).trim()

    if (!nextLabel) {
      setCategoryManagerError('Category names cannot be blank.')
      return
    }

    const nextConfig = {
      ...sectionConfig,
      [sectionKey]: {
        ...sectionConfig[sectionKey],
        label: nextLabel,
      },
    }

    try {
      await persistSectionConfig(nextConfig)
      setCategoryNameDrafts((current) => ({ ...current, [sectionKey]: nextLabel }))
      setCategoryManagerError('')
    } catch (error) {
      setCategoryManagerError(error.message)
    }
  }

  const handleDeleteCategory = async (sectionKey) => {
    const category = sectionConfig[sectionKey]
    if (!window.confirm(`Delete "${category.label}" and all its items? This cannot be undone.`)) return

    try {
      const { sectionConfig: nextConfig } = await adminApiRequest('/api/catalog/settings', {
        method: 'DELETE',
        token: adminSession?.token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey }),
      })
      setSectionConfig(nextConfig)
      setCatalog((current) => {
        const nextCatalog = { ...current }
        delete nextCatalog[sectionKey]
        return nextCatalog
      })
      setCategoryNameDrafts((current) => {
        const nextDrafts = { ...current }
        delete nextDrafts[sectionKey]
        return nextDrafts
      })
      if (activeSection === sectionKey) setActiveSection('all')
      if (selectedItem?.section === sectionKey) setSelectedItem(null)
      setCategoryManagerError('')
    } catch (error) {
      setCategoryManagerError(error.message)
    }
  }

  const handleAddCategory = async (event) => {
    event.preventDefault()

    const trimmedName = newCategoryName.trim()
    if (!trimmedName) {
      setCategoryManagerError('Enter a category name before saving.')
      return
    }

    const slug = normalizeCategoryKey(trimmedName)
    if (!slug) {
      setCategoryManagerError('Category names need a valid title.')
      return
    }

    if (sectionConfig[slug]) {
      setCategoryManagerError('That category already exists.')
      return
    }

    const messageTabs = newCategoryMessageTabs.map((label) => ({
      key: normalizeCategoryKey(label),
      label: label.trim(),
    }))
    if (messageTabs.some((tab) => !tab.key || tab.key.length > 80 || !tab.label || tab.label.length > 60)) {
      setCategoryManagerError('Message tab names must be 1-60 characters and use a valid name.')
      return
    }
    if (new Set(messageTabs.map((tab) => tab.key)).size !== messageTabs.length) {
      setCategoryManagerError('Message tab names must be unique.')
      return
    }

    const nextConfig = {
      ...sectionConfig,
      [slug]: {
        label: trimmedName,
        type: 'custom',
        fields: ['name', 'image', 'description'],
        messageTabs,
      },
    }

    try {
      await persistSectionConfig(nextConfig)
      setCatalog((current) => ({ ...current, [slug]: current[slug] ?? [] }))
      setCategoryNameDrafts((current) => ({ ...current, [slug]: trimmedName }))
      setNewCategoryName('')
      setNewCategoryMessageTabs([])
      setCategoryManagerError('')
    } catch (error) {
      setCategoryManagerError(error.message)
    }
  }

  const filterItems = useMemo(() => {
    const items = asFilterableItems(catalog, sectionList)
    const term = searchTerm.trim().toLowerCase()

    return items.filter((item) => {
      const matchesCategory = activeSection === 'all' || item.sectionKey === activeSection
      const matchesTerm =
        term.length === 0 ||
        item.name.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.requirement?.toLowerCase().includes(term) ||
        item.buff?.toLowerCase().includes(term)

      return matchesCategory && matchesTerm
    })
  }, [activeSection, catalog, searchTerm, sectionList])

  const groupedFilters = useMemo(
    () =>
      sectionList.map((sectionKey) => ({
        key: sectionKey,
        label: sectionConfig[sectionKey].label,
        count: getSectionItems(catalog, sectionKey).length,
      })),
    [catalog, sectionConfig, sectionList],
  )

  useEffect(() => {
    let active = true
    adminApiRequest('/api/catalog/items')
      .then(({ catalog: savedCatalog, sectionConfig: savedConfig, customLogo: savedLogo }) => {
        if (!active) return
        if (!savedCatalog || typeof savedCatalog !== 'object' || Array.isArray(savedCatalog)) {
          throw new Error('The shared catalog API is unavailable.')
        }
        const nextConfig = { ...DEFAULT_SECTION_CONFIG, ...savedConfig }
        setCatalog(savedCatalog)
        setSectionConfig(nextConfig)
        setCustomLogo(savedLogo || '')
        setCategoryNameDrafts(
          Object.fromEntries(Object.entries(nextConfig).map(([key, value]) => [key, value.label])),
        )
        setCatalogError('')
      })
      .catch((error) => {
        if (active) setCatalogError(`Showing sample content because the shared catalog could not be loaded: ${error.message}`)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!adminManagerOpen || !adminSession?.isSuperAdmin) return undefined

    let active = true
    adminApiRequest('/api/admin/codes', { token: adminSession.token })
      .then(({ admins }) => {
        if (active) setAdminEntries(admins)
      })
      .catch((error) => {
        if (active) setAdminManagerError(error.message)
      })

    return () => {
      active = false
    }
  }, [adminManagerOpen, adminSession])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setLoginError('')

    try {
      const { admin } = await adminApiRequest('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      setAdminSession(admin)
      setLoginOpen(false)
      setPin('')
    } catch (error) {
      setLoginError(error.message)
    }
  }

  const handleAddAdminEntry = async (event) => {
    event.preventDefault()
    const name = adminManagerDraft.name.trim()
    const nextPin = adminManagerDraft.pin.trim()

    if (!name || nextPin.length !== 4) {
      setAdminManagerError('Enter a name and a 4-digit PIN for the new admin.')
      return
    }

    setAdminManagerError('')

    try {
      const { admin } = await adminApiRequest('/api/admin/codes', {
        method: 'POST',
        token: adminSession.token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin: nextPin }),
      })
      setAdminEntries((current) => [...current, admin])
      setAdminManagerDraft({ name: '', pin: '' })
    } catch (error) {
      setAdminManagerError(error.message)
    }
  }

  const handleRemoveAdminEntry = async (entryId) => {
    setAdminManagerError('')

    try {
      await adminApiRequest('/api/admin/codes', {
        method: 'DELETE',
        token: adminSession.token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entryId }),
      })
      setAdminEntries((current) => current.filter((entry) => entry.id !== entryId))
    } catch (error) {
      setAdminManagerError(error.message)
    }
  }

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    if (!adminSession?.token) return

    setFormState((current) => ({ ...current, uploading: true, error: '' }))
    try {
      const { image } = await uploadCatalogImage(file, adminSession.token)
      setFormState((current) => ({
        ...current,
        uploading: false,
        draft: { ...current.draft, image },
      }))
    } catch (error) {
      setFormState((current) => ({ ...current, uploading: false, error: error.message }))
    }
  }

  const handleDelete = async (item) => {
    const confirmed = window.confirm(`Delete ${item.name}?`)
    if (!confirmed) return

    try {
      await adminApiRequest('/api/catalog/items', {
        method: 'DELETE',
        token: adminSession?.token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      setCatalog((current) => ({
        ...current,
        [item.section]: current[item.section].filter((entry) => entry.id !== item.id),
      }))
      if (selectedItem?.id === item.id) setSelectedItem(null)
    } catch (error) {
      window.alert(error.message)
    }
  }

  const handleFormSubmit = async (event) => {
    event.preventDefault()
    const sectionKey = formState.sectionKey
    const formData = formState.draft

    if (!formData.name.trim()) {
      setFormState({ ...formState, error: 'Name is required.' })
      return
    }
    if (formState.uploading) {
      setFormState({ ...formState, error: 'Wait for the image upload to finish.' })
      return
    }

    const normalized = {
      ...formData,
      ...(formData.id ? { id: formData.id } : {}),
      name: formData.name.trim(),
      description:
        formData.description?.trim() ||
        (sectionConfig[sectionKey].type === 'playingCard' ? 'Playing Card' : ''),
      requirement: formData.requirement?.trim() || '',
      buff: formData.buff?.trim() || '',
      requiredPowerups: formData.requiredPowerups?.trim() || '',
      howToObtain: formData.howToObtain?.trim() || '',
      completeRules: formData.completeRules?.trim() || '',
      image: formData.image?.trim() || '✦',
      tint: formData.tint || 'gold',
      section: sectionKey,
      type: sectionConfig[sectionKey].type,
    }

    try {
      const { item } = await adminApiRequest('/api/catalog/items', {
        method: formState.mode === 'edit' ? 'PATCH' : 'POST',
        token: adminSession?.token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState.mode === 'edit' ? { id: formData.id, item: normalized } : { item: normalized }),
      })
      setCatalog((current) => {
        const existing = current[sectionKey] ?? []
        const updateList = formState.mode === 'edit'
          ? existing.map((entry) => (entry.id === item.id ? item : entry))
          : [item, ...existing]
        return { ...current, [sectionKey]: updateList }
      })
      setFormState(null)
    } catch (error) {
      setFormState((current) => ({ ...current, error: error.message }))
    }
  }

  const openAddForm = (sectionKey) => {
    setFormState({
      mode: 'add',
      sectionKey,
      draft: defaultDraft(sectionKey, sectionConfig),
      error: '',
    })
  }

  const openEditForm = (item) => {
    setFormState({
      mode: 'edit',
      sectionKey: item.section,
      draft: { ...item },
      error: '',
    })
  }

  const modalFields = selectedItem
    ? [
        { label: 'Type', value: sectionConfig[selectedItem.section]?.label || selectedItem.type },
        { label: 'Name', value: selectedItem.name },
        selectedItem.description ? { label: 'Description', value: selectedItem.description } : null,
        selectedItem.requirement ? { label: 'Requirement', value: selectedItem.requirement } : null,
        selectedItem.buff ? { label: 'Buff', value: selectedItem.buff } : null,
        selectedItem.requiredPowerups ? { label: 'Required powerups', value: selectedItem.requiredPowerups } : null,
        selectedItem.howToObtain ? { label: 'How to obtain', value: selectedItem.howToObtain } : null,
        selectedItem.completeRules ? { label: 'Complete rules', value: selectedItem.completeRules } : null,
      ].filter(Boolean)
    : []

  return (
    <div className="spadez-app">
      {adminSession && (
        <div className="admin-status-bar" role="status">
          {adminSession.isSuperAdmin
            ? 'SUPER Admin Mode, Welcome, ImaLumberTurkey'
            : `Admin Mode, Welcome, ${adminSession.name}`}
        </div>
      )}

      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-logo-wrap">
            <div className="brand-mark" aria-label="SpadeZ logo">
              {customLogo ? <img src={customLogo} alt="SpadeZ logo" /> : 'S'}
            </div>
            {adminSession?.isSuperAdmin && (
              <>
                <input
                  ref={logoInputRef}
                  className="logo-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  aria-label="Choose a new logo image"
                />
                <button
                  type="button"
                  className="logo-change-button"
                  aria-label="Change logo"
                  title="Change logo"
                  onClick={() => logoInputRef.current?.click()}
                >
                  +
                </button>
              </>
            )}
          </div>
          <div>
            <div className="brand-title">SpadeZ Blackjack</div>
            <div className="brand-subtitle">Collection guide</div>
          </div>
        </div>

        <div className="header-tools">
          <label className="search-box" aria-label="Search catalog">
            <span>⌕</span>
            <input
              type="search"
              placeholder="Search items"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          {adminSession ? (
            <button type="button" className="admin-button" onClick={() => setAdminSession(null)}>
              Exit admin
            </button>
          ) : (
            <button type="button" className="admin-button" onClick={() => setLoginOpen(true)}>
              Admin
            </button>
          )}
          {adminSession?.isSuperAdmin && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setAdminManagerError('')
                setAdminManagerOpen(true)
              }}
            >
              Manage admins & categories
            </button>
          )}
        </div>
      </header>

      <nav className="category-bar" aria-label="Category filters">
        <button
          type="button"
          className={activeSection === 'all' ? 'chip active' : 'chip'}
          onClick={() => setActiveSection('all')}
        >
          All
        </button>
        {groupedFilters.map((section) => (
          <button
            key={section.key}
            type="button"
            className={activeSection === section.key ? 'chip active' : 'chip'}
            onClick={() => setActiveSection(section.key)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {catalogError && <p className="error-message" role="alert">{catalogError}</p>}

      {loginOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card login-card">
            <div className="modal-header">
              <h3>Admin secure access</h3>
              <button type="button" className="close-button" onClick={() => setLoginOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleAuthSubmit} className="admin-form">
              <label>
                PIN
                <input
                  type="password"
                  maxLength={4}
                  inputMode="numeric"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter 4-digit PIN"
                />
              </label>
              {loginError && <p className="error-message">{loginError}</p>}
              <button type="submit" className="primary-button">
                Verify admin PIN
              </button>
            </form>
          </div>
        </div>
      )}

      {adminManagerOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card form-card">
            <div className="modal-header">
              <h3>Manage admins & categories</h3>
              <button type="button" className="close-button" onClick={() => setAdminManagerOpen(false)}>
                ×
              </button>
            </div>

            <div className="admin-registry-summary">
              <span>Super admin code is configured server-side.</span>
              <span>Super admin: {adminSession.name}</span>
            </div>

            <div className="admin-registry-list">
              {adminEntries.length === 0 ? (
                <p className="empty-message">No additional admin accounts configured.</p>
              ) : (
                adminEntries.map((entry) => (
                  <div key={entry.id} className="admin-registry-row">
                    <div>
                      <strong>{entry.name}</strong>
                      <span>PIN stored securely</span>
                    </div>
                    <button type="button" className="mini-button danger" onClick={() => handleRemoveAdminEntry(entry.id)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddAdminEntry} className="admin-form">
              <label>
                Admin name
                <input
                  type="text"
                  value={adminManagerDraft.name}
                  onChange={(event) =>
                    setAdminManagerDraft({ ...adminManagerDraft, name: event.target.value })
                  }
                  placeholder="e.g. Avery Stone"
                />
              </label>
              <label>
                4-digit PIN
                <input
                  type="password"
                  maxLength={4}
                  inputMode="numeric"
                  value={adminManagerDraft.pin}
                  onChange={(event) =>
                    setAdminManagerDraft({
                      ...adminManagerDraft,
                      pin: event.target.value.replace(/\D/g, '').slice(0, 4),
                    })
                  }
                  placeholder="1234"
                />
              </label>
              {adminManagerError && <p className="error-message">{adminManagerError}</p>}
              <button type="submit" className="primary-button">
                Add admin PIN
              </button>
            </form>

            <div className="admin-section-block">
              <h4>Category names</h4>
              <div className="category-editor-list">
                {sectionList.map((sectionKey) => (
                  <div key={sectionKey} className="category-editor-row">
                    <input
                      type="text"
                      value={categoryNameDrafts[sectionKey] ?? sectionConfig[sectionKey].label}
                      onChange={(event) =>
                        setCategoryNameDrafts((current) => ({
                          ...current,
                          [sectionKey]: event.target.value,
                        }))
                      }
                    />
                    <button type="button" className="mini-button" onClick={() => handleRenameCategory(sectionKey)}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="mini-button danger"
                      disabled={sectionList.length <= 1}
                      title={sectionList.length <= 1 ? 'At least one category must remain.' : `Delete ${sectionConfig[sectionKey].label}`}
                      aria-label={`Delete category ${sectionConfig[sectionKey].label}`}
                      onClick={() => handleDeleteCategory(sectionKey)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddCategory} className="admin-form">
                <label>
                  Add new category
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="e.g. Boss Battles"
                  />
                </label>
                <div className="message-tab-editor">
                  <span>Message tabs</span>
                  {newCategoryMessageTabs.map((tabName, index) => (
                    <div key={index} className="message-tab-editor-row">
                      <input
                        type="text"
                        value={tabName}
                        aria-label={`Message tab ${index + 1} name`}
                        onChange={(event) =>
                          setNewCategoryMessageTabs((current) =>
                            current.map((name, tabIndex) => (tabIndex === index ? event.target.value : name)),
                          )
                        }
                        placeholder="e.g. Strategy"
                      />
                      <button
                        type="button"
                        className="mini-button danger"
                        aria-label={`Remove message tab ${index + 1}`}
                        onClick={() =>
                          setNewCategoryMessageTabs((current) => current.filter((_, tabIndex) => tabIndex !== index))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {newCategoryMessageTabs.length < 12 && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setNewCategoryMessageTabs((current) => [...current, ''])}
                    >
                      Add message tab
                    </button>
                  )}
                </div>
                {categoryManagerError && <p className="error-message">{categoryManagerError}</p>}
                <button type="submit" className="primary-button">
                  Add category
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {formState && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card form-card">
            <div className="modal-header">
              <h3>{formState.mode === 'edit' ? 'Edit item' : 'Add item'}</h3>
              <button type="button" className="close-button" onClick={() => setFormState(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="item-form">
              <label>
                Name
                <input
                  type="text"
                  value={formState.draft.name}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      draft: { ...formState.draft, name: event.target.value },
                    })
                  }
                  required
                />
              </label>

              <label>
                Image / Badge
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </label>

              <label>
                Fallback text badge
                <input
                  type="text"
                  value={formState.draft.image}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      draft: { ...formState.draft, image: event.target.value },
                    })
                  }
                  placeholder="Optional text badge like A♠ or ✦"
                />
              </label>

              {formState.sectionKey === 'powerups' || formState.sectionKey === 'playingCards' || formState.sectionKey === 'currency' ? (
                <label>
                  Description
                  <input
                    type="text"
                    value={formState.draft.description}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        draft: { ...formState.draft, description: event.target.value },
                      })
                    }
                    placeholder={formState.sectionKey === 'playingCards' ? 'Playing Card' : 'Describe this item'}
                  />
                </label>
              ) : null}

              {['joker', 'ace', 'fate', 'minigame', 'prestige', 'challenges', 'trophies'].includes(formState.sectionKey) && (
                <label>
                  Description
                  <textarea
                    rows={3}
                    value={formState.draft.description}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        draft: { ...formState.draft, description: event.target.value },
                      })
                    }
                  />
                </label>
              )}

              {(sectionConfig[formState.sectionKey]?.messageTabs ?? []).map((tab) => (
                <label key={tab.key}>
                  {tab.label}
                  <textarea
                    rows={4}
                    value={formState.draft.messages?.[tab.key] ?? ''}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        draft: {
                          ...current.draft,
                          messages: { ...current.draft.messages, [tab.key]: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
              ))}

  const selectedMessageTabs = selectedItem
    ? sectionConfig[selectedItem.section]?.messageTabs ?? []
    : []

              {formState.sectionKey === 'joker' && (
                <>
                  <label>
                    Required powerups
                    <input
                      type="text"
                      value={formState.draft.requiredPowerups}
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          draft: { ...formState.draft, requiredPowerups: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    How to obtain
                    <textarea
                      rows={3}
                      value={formState.draft.howToObtain}
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          draft: { ...formState.draft, howToObtain: event.target.value },
                        })
                      }
                    />
                  </label>
                </>
              )}

              {(formState.sectionKey === 'prestige' || formState.sectionKey === 'trophies') && (
                <>
                  <label>
                    Requirement
                    <input
                      type="text"
                      value={formState.draft.requirement}
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          draft: { ...formState.draft, requirement: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    Buff
                    <input
                      type="text"
                      value={formState.draft.buff}
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          draft: { ...formState.draft, buff: event.target.value },
                        })
                      }
                    />
                  </label>
                </>
              )}

              {formState.sectionKey === 'challenge' && (
                <label>
                  Complete rules
                  <textarea
                    rows={4}
                    value={formState.draft.completeRules}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        draft: { ...formState.draft, completeRules: event.target.value },
                      })
                    }
                  />
                </label>
              )}

              {formState.error && <p className="error-message" role="alert">{formState.error}</p>}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setFormState(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  {formState.uploading ? 'Uploading image…' : formState.mode === 'edit' ? 'Save changes' : 'Add item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="catalog-layout">
        {filterItems.length === 0 && !adminSession && activeSection === 'all' ? (
          <div className="empty-state">
            <h2>{searchTerm.trim() ? 'No items match that filter.' : 'No catalog items yet.'}</h2>
            <p>{searchTerm.trim() ? 'Try a different keyword or choose another category.' : 'There are no items to show yet.'}</p>
          </div>
        ) : (
          Object.entries(sectionConfig)
            .filter(([sectionKey]) => activeSection === 'all' || sectionKey === activeSection)
            .map(([sectionKey, sectionMeta]) => {
            const sectionItems = filterItems.filter((item) => item.sectionKey === sectionKey)
            const allSectionItems = getSectionItems(catalog, sectionKey)

            if (sectionItems.length === 0 && !adminSession && activeSection === 'all') {
              return null
            }

            return (
              <section
                key={sectionKey}
                className="catalog-section"
                data-selected={activeSection === sectionKey ? 'true' : 'false'}
              >
                <div className="section-header">
                  <h2>{sectionMeta.label}</h2>
                  {adminSession && (
                    <button type="button" className="small-button" onClick={() => openAddForm(sectionKey)}>
                      Add Item
                    </button>
                  )}
                </div>

                <div className="card-grid">
                  {sectionItems.length === 0 ? (
                    <p className="empty-message">
                      {allSectionItems.length === 0
                        ? 'No items in this category yet.'
                        : 'No items in this category match the current search.'}
                    </p>
                  ) : sectionItems.map((item) => (
                    <article
                      key={item.id}
                      className={`catalog-card ${item.tint} ${activeSection !== 'all' ? 'active-grid' : ''}`}
                      onClick={() => {
                        setSelectedItem(item)
                        setActiveMessageTab(sectionConfig[sectionKey]?.messageTabs?.[0]?.key ?? '')
                      }}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          setSelectedItem(item)
                          setActiveMessageTab(sectionConfig[sectionKey]?.messageTabs?.[0]?.key ?? '')
                        }
                      }}
                    >
                      {CHECKABLE_SECTIONS.has(sectionKey) && !adminSession && (
                        <label
                          className="item-checkmark"
                          title={checkedItems.has(`${sectionKey}:${item.id}`) ? 'Mark incomplete' : 'Mark complete'}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checkedItems.has(`${sectionKey}:${item.id}`)}
                            aria-label={`Mark ${item.name} as complete`}
                            onChange={() => toggleItemChecked(sectionKey, item.id)}
                          />
                        </label>
                      )}
                      <div className="card-art" aria-hidden="true">
                        {isImageSource(item.image) ? (
                          <img src={item.image} alt={item.name} className="art-image" />
                        ) : (
                          item.image || '✦'
                        )}
                      </div>
                      <div className="card-copy">
                        <div className="card-row">
                          <h3>{item.name}</h3>
                          {adminSession && (
                            <div className="card-actions" onClick={(event) => event.stopPropagation()}>
                              <button type="button" className="mini-button" onClick={() => openEditForm(item)}>
                                Edit
                              </button>
                              <button type="button" className="mini-button danger" onClick={() => handleDelete(item)}>
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <p>{item.description}</p>
                        {item.requirement && <span className="meta-pill">{item.requirement}</span>}
                        {item.buff && <span className="meta-pill">{item.buff}</span>}
                        {item.requiredPowerups && <span className="meta-pill">{item.requiredPowerups}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )
            })
        )}
      </main>

      {selectedItem && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card detail-card">
            <div className="modal-header">
              <h3>{selectedItem.name}</h3>
              <button type="button" className="close-button" onClick={() => setSelectedItem(null)}>
                ×
              </button>
            </div>
            <div className="detail-visual" aria-hidden="true">
              {isImageSource(selectedItem.image) ? (
                <img src={selectedItem.image} alt={selectedItem.name} className="art-image large" />
              ) : (
                selectedItem.image || '✦'
              )}
            </div>
            <div className="detail-list">
              {modalFields.map((field) => (
                <div key={field.label} className="detail-row">
                  <span>{field.label}</span>
                  <p>{field.value}</p>
                </div>
              ))}
            </div>
            {selectedMessageTabs.length > 0 && (
              <div className="message-tab-panel">
                <div className="message-tabs" role="tablist" aria-label="Item messages">
                  {selectedMessageTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeMessageTab === tab.key}
                      className={activeMessageTab === tab.key ? 'message-tab active' : 'message-tab'}
                      onClick={() => setActiveMessageTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="message-tab-content" role="tabpanel">
                  {selectedItem.messages?.[activeMessageTab] || 'No message added.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
