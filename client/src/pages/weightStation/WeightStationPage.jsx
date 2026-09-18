import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scale, ScanBarcode, CheckCircle2, AlertCircle, History, Search,
  RefreshCw, Box, Layers, X, ChevronRight, Database, Square,
  Calendar, Filter, User, Tag
} from 'lucide-react';
import {
  searchProducts, updateProductWeight, getWeightLogs,
  triggerInventorySync, getInventorySyncStatus, cancelSync, deleteFailedLogs
} from '../../api/weightStation';
import { useAuth } from '../../context/AuthContext';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB', GREEN = '#10B981', AMBER = '#F59E0B', RED = '#EF4444';
const SHADOW = '0 2px 8px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

export default function WeightStationPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState('station'); // 'station' | 'logs'
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchError, setSearchError] = useState(null);

  // Sync status polling
  const { data: syncStatus, refetch: refetchSyncStatus } = useQuery({
    queryKey: ['inventory-sync-status'],
    queryFn: getInventorySyncStatus,
    refetchInterval: 3000
  });

  const syncMutation = useMutation({
    mutationFn: triggerInventorySync,
    onSuccess: () => {
      setTimeout(() => refetchSyncStatus(), 1000);
    }
  });

  const stopSyncMutation = useMutation({
    mutationFn: cancelSync,
    onSuccess: () => {
      refetchSyncStatus();
    }
  });

  // Weighing & Measurement state
  const [unit, setUnit] = useState('g'); // 'g' | 'kg'
  const [enteredWeight, setEnteredWeight] = useState('');
  const [enteredLength, setEnteredLength] = useState('');
  const [enteredWidth, setEnteredWidth] = useState('');
  const [enteredHeight, setEnteredHeight] = useState('');
  const [notes, setNotes] = useState('');

  // Debounce / stabilization simulation
  const [stabilizing, setStabilizing] = useState(false);
  const [stabilized, setStabilized] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const debounceTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  // Success and Error feedback state
  const [successToast, setSuccessToast] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  // Focus management for barcode scanner
  const barcodeInputRef = useRef(null);
  const weightInputRef = useRef(null);

  // Reset station state
  function resetStation() {
    setSelectedProduct(null);
    setSearchResults([]);
    setSearchError(null);
    setUpdateError(null);
    setBarcodeInput('');
    setEnteredWeight('');
    setEnteredLength('');
    setEnteredWidth('');
    setEnteredHeight('');
    setNotes('');
    setStabilized(false);
    setStabilizing(false);
    setCountdown(0);
    clearInterval(countdownIntervalRef.current);
    clearTimeout(debounceTimerRef.current);

    setTimeout(() => {
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    }, 50);
  }

  // Listen to sidebar click navigation to reset station to initial blank state
  useEffect(() => {
    function handleSidebarReset() {
      setActiveTab('station');
      resetStation();
    }
    window.addEventListener('reset-weight-station', handleSidebarReset);
    return () => window.removeEventListener('reset-weight-station', handleSidebarReset);
  }, []);

  // Keep barcode input focused on mount and whenever in station mode with no selected product
  useEffect(() => {
    if (activeTab === 'station' && !selectedProduct && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [activeTab, selectedProduct]);

  // Handle Barcode Scan / Search
  async function handleScanSubmit(e) {
    if (e) e.preventDefault();
    const query = barcodeInput.trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError(null);
    setUpdateError(null);
    setSearchResults([]);

    try {
      const data = await searchProducts(query);
      const items = data.products || [];

      if (items.length === 0) {
        setSearchError(`No product found with barcode "${query}". If this is a newly added item, click "Reset & Re-sync" above.`);
      } else if (items.length === 1) {
        selectProduct(items[0]);
      } else {
        // Multiple products match (e.g. across multiple customers)
        setSearchResults(items);
      }
    } catch (err) {
      setSearchError(err?.response?.data?.error || 'Failed to search inventory');
    } finally {
      setIsSearching(false);
    }
  }

  function selectProduct(prod) {
    setSelectedProduct(prod);
    setSearchResults([]);
    setSearchError(null);
    setUpdateError(null);
    setBarcodeInput('');
    setEnteredWeight('');
    setEnteredLength(prod.length ? String(prod.length) : '');
    setEnteredWidth(prod.width ? String(prod.width) : '');
    setEnteredHeight(prod.height ? String(prod.height) : '');
    setStabilized(false);
    setStabilizing(false);

    // Auto-focus weight input after product selected
    setTimeout(() => {
      if (weightInputRef.current) {
        weightInputRef.current.focus();
      }
    }, 100);
  }

  // Weight input handler with USB scale debounce stabilization
  function handleWeightChange(val) {
    setEnteredWeight(val);
    setStabilized(false);
    setUpdateError(null);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setStabilizing(true);
      setCountdown(1.5);

      const startTime = Date.now();
      const totalDuration = 1500; // 1.5 seconds debounce

      countdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, (totalDuration - elapsed) / 1000);
        setCountdown(Math.round(remaining * 10) / 10);
        if (elapsed >= totalDuration) {
          clearInterval(countdownIntervalRef.current);
        }
      }, 100);

      debounceTimerRef.current = setTimeout(() => {
        setStabilizing(false);
        setStabilized(true);
      }, totalDuration);
    } else {
      setStabilizing(false);
      setStabilized(false);
    }
  }

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: updateProductWeight,
    onSuccess: (res) => {
      setUpdateError(null);
      qc.invalidateQueries({ queryKey: ['weight-station-logs'] });
      setSuccessToast({
        sku: selectedProduct.sku,
        name: selectedProduct.name,
        newWeight: `${res.weight_g} g (${res.weight_kg} kg)`,
        customer: selectedProduct.customer_name
      });
      setTimeout(() => setSuccessToast(null), 4500);
      resetStation();
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || err.message || 'Helm update rejected the request';
      setUpdateError(msg);
    }
  });

  function handleSubmitUpdate(e) {
    if (e) e.preventDefault();
    if (!selectedProduct) return;
    const finalWeight = parseFloat(enteredWeight);
    if (isNaN(finalWeight) || finalWeight <= 0) {
      alert('Please enter a valid weight from the scale.');
      return;
    }

    updateMutation.mutate({
      product_id: selectedProduct.id,
      sku: selectedProduct.sku,
      customer_id: selectedProduct.customer_id,
      helm_customer_id: selectedProduct.helm_customer_id,
      customer_name: selectedProduct.customer_name,
      product_name: selectedProduct.name,
      barcode: selectedProduct.barcode,
      new_weight: finalWeight,
      weight_unit: unit,
      old_weight: unit === 'kg' ? selectedProduct.weight_kg : selectedProduct.weight_g,
      new_length: enteredLength ? parseFloat(enteredLength) : null,
      new_width: enteredWidth ? parseFloat(enteredWidth) : null,
      new_height: enteredHeight ? parseFloat(enteredHeight) : null,
      old_length: selectedProduct.length,
      old_width: selectedProduct.width,
      old_height: selectedProduct.height,
      dimension_unit: 'cm',
      notes
    });
  }

  // Calculate delta comparison
  const parsedNewWeightG = unit === 'kg' ? (parseFloat(enteredWeight) || 0) * 1000 : (parseFloat(enteredWeight) || 0);
  const oldWeightG = selectedProduct?.weight_g || 0;
  const weightDiffG = parsedNewWeightG - oldWeightG;
  const weightDiffPct = oldWeightG > 0 ? Math.round((weightDiffG / oldWeightG) * 100) : null;

  return (
    <div style={{ width: '100%', maxWidth: 'none', minHeight: 'calc(100vh - 100px)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: 0, letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={26} color={ACCENT} /> Weigh & Measure Station
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Cache Sync Status & Trigger */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fff', border: '1px solid #CBD5E1', borderRadius: 10,
            padding: '6px 12px', fontSize: 12, color: MUTED, boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
          }}>
            <Database size={14} color={ACCENT} />
            <span>
              <strong>{syncStatus?.total_products ? syncStatus.total_products.toLocaleString() : '0'}</strong> physical items
            </span>

            {syncStatus?.in_progress ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11.5, color: ACCENT, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={11} className="animate-spin" /> Rebuilding Cache...
                </span>
                <button
                  onClick={() => stopSyncMutation.mutate()}
                  disabled={stopSyncMutation.isPending}
                  style={{
                    border: 'none', background: '#FEF2F2', color: RED,
                    fontWeight: 700, fontSize: 11, padding: '3px 7px', borderRadius: 5,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3
                  }}
                  title="Cancel background rebuild"
                >
                  <Square size={10} /> Stop
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm('This will wipe the current local cache and rebuild purely physical inventory (Type 1, 11,374 items) for active customers. Proceed?')) {
                    syncMutation.mutate();
                  }
                }}
                disabled={syncMutation.isPending}
                style={{
                  border: 'none', background: '#EFF6FF', color: ACCENT,
                  fontWeight: 700, fontSize: 11.5, padding: '4px 9px', borderRadius: 6,
                  cursor: syncMutation.isPending ? 'default' : 'pointer', display: 'flex',
                  alignItems: 'center', gap: 4
                }}
              >
                <RefreshCw size={11} className={syncMutation.isPending ? 'animate-spin' : ''} />
                Reset & Re-sync
              </button>
            )}
          </div>

          {/* Tab Switcher */}
          <div style={{ display: 'flex', background: '#E2E8F0', padding: 3, borderRadius: 10, gap: 4 }}>
            <button
              onClick={() => setActiveTab('station')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, border: 'none',
                background: activeTab === 'station' ? '#fff' : 'transparent',
                color: activeTab === 'station' ? TITLE : MUTED,
                fontWeight: 700, fontSize: 13, padding: '7px 16px', borderRadius: 8,
                cursor: 'pointer', boxShadow: activeTab === 'station' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <Scale size={15} /> Scale Station
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, border: 'none',
                background: activeTab === 'logs' ? '#fff' : 'transparent',
                color: activeTab === 'logs' ? TITLE : MUTED,
                fontWeight: 700, fontSize: 13, padding: '7px 16px', borderRadius: 8,
                cursor: 'pointer', boxShadow: activeTab === 'logs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <History size={15} /> Audit History
            </button>
          </div>
        </div>
      </div>

      {/* Success Toast Banner */}
      {successToast && (
        <div style={{
          background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(16,185,129,0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircle2 size={24} color={GREEN} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Weight successfully updated in Helm!</div>
              <div style={{ fontSize: 13, color: '#047857' }}>
                <strong>{successToast.sku}</strong> ({successToast.customer}) updated to <strong>{successToast.newWeight}</strong>
              </div>
            </div>
          </div>
          <button onClick={() => setSuccessToast(null)} style={{ background: 'none', border: 'none', color: '#047857', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
      )}

      {/* ── TAB 1: MAIN STATION VIEW ── */}
      {activeTab === 'station' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 1. GIANT SCAN BARCODE INPUT */}
          <div style={{
            background: '#fff', borderRadius: 16, padding: '24px 28px',
            boxShadow: SHADOW, border: '2px solid',
            borderColor: selectedProduct ? '#E2E8F0' : ACCENT,
            position: 'relative', overflow: 'hidden'
          }}>
            {!selectedProduct && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 4,
                background: 'linear-gradient(90deg, #0056FB, #7B2FBE, #0056FB)',
                backgroundSize: '200% 100%'
              }} />
            )}

            <form onSubmit={handleScanSubmit} style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: ACCENT }}>
                  <ScanBarcode size={28} />
                </div>
                <input
                  ref={barcodeInputRef}
                  type="text"
                  placeholder="Scan product barcode (barcode-only search)..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '16px 20px 16px 56px',
                    fontSize: 18, fontWeight: 600,
                    borderRadius: 12, border: '2px solid #CBD5E1',
                    outline: 'none', fontFamily: 'inherit',
                    background: '#F8FAFC', color: TITLE,
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)'
                  }}
                  onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.target.style.borderColor = '#CBD5E1')}
                />
              </div>

              <button
                type="submit"
                disabled={isSearching || !barcodeInput.trim()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: ACCENT, color: '#fff', border: 'none',
                  borderRadius: 12, padding: '16px 26px', fontSize: 16,
                  fontWeight: 700, cursor: isSearching ? 'default' : 'pointer',
                  opacity: isSearching || !barcodeInput.trim() ? 0.6 : 1,
                  boxShadow: '0 2px 8px rgba(0,86,251,0.25)'
                }}
              >
                {isSearching ? <RefreshCw size={20} className="animate-spin" /> : <Search size={20} />}
                Lookup Barcode
              </button>

              {selectedProduct && (
                <button
                  type="button"
                  onClick={resetStation}
                  style={{
                    background: '#F1F5F9', border: '1px solid #CBD5E1',
                    borderRadius: 12, padding: '16px 20px', fontSize: 14,
                    fontWeight: 700, color: MUTED, cursor: 'pointer'
                  }}
                >
                  Clear / Next Item
                </button>
              )}
            </form>

            {searchError && (
              <div style={{
                marginTop: 14, background: '#FEF2F2', border: '1px solid #FECACA',
                color: '#991B1B', padding: '10px 14px', borderRadius: 8,
                fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8
              }}>
                <AlertCircle size={16} /> {searchError}
              </div>
            )}
          </div>

          {/* 2. MULTI-PRODUCT DISAMBIGUATION PICKER */}
          {searchResults.length > 1 && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: SHADOW }}>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Layers size={20} color={ACCENT} /> Multiple Products Share This Barcode ({searchResults.length})
                  </div>
                  <div style={{ fontSize: 13, color: MUTED }}>
                    This barcode is assigned across multiple customer records. Select the correct one to weigh:
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                {searchResults.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => selectProduct(prod)}
                    style={{
                      border: '2px solid #E2E8F0', borderRadius: 14, padding: 18,
                      cursor: 'pointer', transition: 'all 0.15s ease',
                      background: '#F8FAFC', display: 'flex', gap: 14, alignItems: 'center',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = ACCENT;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,86,251,0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#E2E8F0';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {/* Image / Icon */}
                    <div style={{
                      width: 64, height: 64, borderRadius: 10, background: '#fff',
                      border: '1px solid #CBD5E1', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', overflow: 'hidden', flexShrink: 0
                    }}>
                      {prod.image_url ? (
                        <img src={prod.image_url} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <Box size={28} color="#94A3B8" />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'inline-block', fontSize: 10.5, fontWeight: 800,
                        background: '#EEF2FF', color: '#4338CA', padding: '2px 7px',
                        borderRadius: 5, marginBottom: 4
                      }}>
                        {prod.customer_name}
                      </span>
                      <div style={{ fontWeight: 800, fontSize: 14, color: TITLE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {prod.sku}
                      </div>
                      <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {prod.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                        Current: <strong>{prod.weight_g} g</strong> ({prod.weight_kg} kg)
                      </div>
                    </div>

                    <ChevronRight size={20} color="#94A3B8" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. PRODUCT SPOTLIGHT & SCALE WEIGHT CAPTURE STAGE */}
          {selectedProduct && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(420px, 1.4fr)', gap: 24 }}>
              {/* Left Column: Product Spotlight Details */}
              <div style={{ background: '#fff', borderRadius: 16, padding: 26, boxShadow: SHADOW, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{
                    fontSize: 11.5, fontWeight: 800, background: '#EFF6FF',
                    color: ACCENT, padding: '4px 10px', borderRadius: 6,
                    border: '1px solid #BFDBFE'
                  }}>
                    🏢 {selectedProduct.customer_name}
                  </span>
                  <span style={{ fontSize: 12, color: MUTED }}>Helm ID: #{selectedProduct.id}</span>
                </div>

                {/* Big Image Display */}
                <div style={{
                  width: '100%', height: 220, borderRadius: 12, background: '#F8FAFC',
                  border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', overflow: 'hidden', marginBottom: 18
                }}>
                  {selectedProduct.image_url ? (
                    <img
                      src={selectedProduct.image_url}
                      alt={selectedProduct.name}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#94A3B8' }}>
                      <Box size={56} strokeWidth={1.5} />
                      <div style={{ fontSize: 12, marginTop: 6 }}>No product image available</div>
                    </div>
                  )}
                </div>

                {/* Product Titles */}
                <div style={{ fontSize: 20, fontWeight: 800, color: TITLE, marginBottom: 4 }}>
                  {selectedProduct.sku}
                </div>
                <div style={{ fontSize: 14, color: MUTED, marginBottom: 18, lineHeight: 1.4 }}>
                  {selectedProduct.name}
                </div>

                {/* Barcode badge */}
                {selectedProduct.barcode && (
                  <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
                    <ScanBarcode size={15} color={ACCENT} /> Barcode: <strong>{selectedProduct.barcode}</strong>
                  </div>
                )}

                {/* Current Helm Physical Profile */}
                <div style={{ marginTop: 'auto', background: '#F8FAFC', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                    Current Recorded Specs in Helm
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: '#fff', padding: 10, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 11, color: MUTED }}>Weight</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: TITLE }}>
                        {selectedProduct.weight_g} g <span style={{ fontSize: 12, fontWeight: 500, color: MUTED }}>({selectedProduct.weight_kg} kg)</span>
                      </div>
                    </div>
                    <div style={{ background: '#fff', padding: 10, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 11, color: MUTED }}>Dimensions (L×W×H)</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TITLE }}>
                        {selectedProduct.length || '—'} × {selectedProduct.width || '—'} × {selectedProduct.height || '—'} cm
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: USB Scale Input & Helm Sync Form */}
              <div style={{ background: '#fff', borderRadius: 16, padding: 26, boxShadow: SHADOW, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Scale size={22} color={ACCENT} /> USB Scale & Weight Capture
                  </div>

                  {/* Unit Selector */}
                  <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 8, padding: 2 }}>
                    <button
                      type="button"
                      onClick={() => setUnit('g')}
                      style={{
                        border: 'none', background: unit === 'g' ? ACCENT : 'transparent',
                        color: unit === 'g' ? '#fff' : MUTED, fontWeight: 700,
                        fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer'
                      }}
                    >
                      Grams (g)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnit('kg')}
                      style={{
                        border: 'none', background: unit === 'kg' ? ACCENT : 'transparent',
                        color: unit === 'kg' ? '#fff' : MUTED, fontWeight: 700,
                        fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer'
                      }}
                    >
                      Kilograms (kg)
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSubmitUpdate} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 18 }}>
                  {/* GIANT WEIGHT INPUT */}
                  <div style={{
                    background: '#F8FAFC', borderRadius: 16, padding: 20,
                    border: '2px solid',
                    borderColor: stabilized ? GREEN : (stabilizing ? AMBER : ACCENT),
                    transition: 'border-color 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: TITLE }}>
                        Scale Weight ({unit === 'g' ? 'Grams' : 'Kilograms'})
                      </label>
                      {stabilizing && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <RefreshCw size={13} className="animate-spin" /> Stabilizing ({countdown}s)...
                        </span>
                      )}
                      {stabilized && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: GREEN, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <CheckCircle2 size={14} /> Scale reading locked & stable
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <input
                        ref={weightInputRef}
                        type="number"
                        step={unit === 'g' ? '1' : '0.001'}
                        placeholder={unit === 'g' ? 'e.g. 450' : 'e.g. 0.45'}
                        value={enteredWeight}
                        onChange={(e) => handleWeightChange(e.target.value)}
                        style={{
                          flex: 1, fontSize: 32, fontWeight: 800,
                          padding: '12px 18px', borderRadius: 12,
                          border: '2px solid #CBD5E1', outline: 'none',
                          color: TITLE, background: '#fff', fontFamily: 'inherit'
                        }}
                      />
                      <span style={{ fontSize: 24, fontWeight: 800, color: MUTED }}>
                        {unit}
                      </span>
                    </div>

                    {/* Delta Comparison Badge */}
                    {enteredWeight && !isNaN(parsedNewWeightG) && parsedNewWeightG > 0 && (
                      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                        <span style={{ color: MUTED }}>Difference from Helm:</span>
                        <span style={{
                          padding: '3px 8px', borderRadius: 6,
                          background: weightDiffG === 0 ? '#F1F5F9' : (Math.abs(weightDiffG) > 200 ? '#FEF3C7' : '#EFF6FF'),
                          color: weightDiffG === 0 ? MUTED : (Math.abs(weightDiffG) > 200 ? '#B45309' : ACCENT)
                        }}>
                          {weightDiffG > 0 ? `+${weightDiffG} g` : `${weightDiffG} g`}
                          {weightDiffPct != null && ` (${weightDiffPct > 0 ? `+${weightDiffPct}` : weightDiffPct}%)`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Optional Dimension Tweaks */}
                  <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: TITLE, marginBottom: 8 }}>
                      Package Dimensions (Optional - in cm)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div>
                        <span style={{ fontSize: 11, color: MUTED }}>Length (cm)</span>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="L"
                          value={enteredLength}
                          onChange={(e) => setEnteredLength(e.target.value)}
                          style={dimInputStyle}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: 11, color: MUTED }}>Width (cm)</span>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="W"
                          value={enteredWidth}
                          onChange={(e) => setEnteredWidth(e.target.value)}
                          style={dimInputStyle}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: 11, color: MUTED }}>Height (cm)</span>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="H"
                          value={enteredHeight}
                          onChange={(e) => setEnteredHeight(e.target.value)}
                          style={dimInputStyle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Operator Notes (Optional) */}
                  <input
                    type="text"
                    placeholder="Optional operator notes (e.g. weighed with primary packaging)..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      border: '1px solid #E2E8F0', borderRadius: 10,
                      padding: '10px 14px', fontSize: 13, fontFamily: 'inherit'
                    }}
                  />

                  {/* Error banner if Helm update failed */}
                  {updateError && (
                    <div style={{
                      background: '#FEF2F2', border: '1px solid #FCA5A5',
                      borderRadius: 12, padding: '12px 16px', color: '#B91C1C',
                      fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10
                    }}>
                      <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <strong>Helm Sync Rejected:</strong> {updateError}
                      </div>
                    </div>
                  )}

                  {/* GIANT SUBMIT BUTTON */}
                  <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                    <button
                      type="submit"
                      disabled={updateMutation.isPending || !enteredWeight || isNaN(parseFloat(enteredWeight))}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', gap: 10,
                        background: updateMutation.isPending ? '#94A3B8' : (stabilized ? '#059669' : ACCENT),
                        color: '#fff', border: 'none', borderRadius: 14,
                        padding: '16px', fontSize: 17, fontWeight: 800,
                        cursor: updateMutation.isPending ? 'default' : 'pointer',
                        boxShadow: '0 4px 14px rgba(0,86,251,0.25)',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      {updateMutation.isPending ? (
                        <>
                          <RefreshCw size={20} className="animate-spin" /> Updating Helm WMS...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={22} /> Confirm & Sync to Helm
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Idle Warehouse Prompt */}
          {!selectedProduct && searchResults.length === 0 && (
            <div style={{
              background: '#fff', borderRadius: 16, padding: '48px 24px',
              textAlign: 'center', boxShadow: SHADOW
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: 20, background: '#EFF6FF',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: ACCENT, marginBottom: 16
              }}>
                <ScanBarcode size={38} />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: TITLE, margin: '0 0 6px' }}>
                Station Ready for Barcode Scan
              </h3>
              <p style={{ fontSize: 14, color: MUTED, maxWidth: 500, margin: '0 auto' }}>
                Scan any product barcode with your scanner. The product profile will be retrieved instantly for weight capture.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: AUDIT LOGS TAB ── */}
      {activeTab === 'logs' && <AuditLogsView />}
    </div>
  );
}

// ── Audit History Logs View ──────────────────────────────────────────────────
function AuditLogsView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const limit = 25;

  // Auto-prune failed logs on mount
  useEffect(() => {
    deleteFailedLogs().catch(() => {});
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['weight-station-logs', searchTerm, skuFilter, userFilter, startDate, endDate, page],
    queryFn: () => getWeightLogs({
      q: searchTerm,
      sku: skuFilter,
      user: userFilter,
      startDate,
      endDate,
      limit,
      offset: page * limit
    })
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  function resetFilters() {
    setSearchTerm('');
    setSkuFilter('');
    setUserFilter('');
    setStartDate('');
    setEndDate('');
    setPage(0);
  }

  const hasActiveFilters = Boolean(searchTerm || skuFilter || userFilter || startDate || endDate);

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: SHADOW }}>
      {/* Top Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={20} color={ACCENT} /> Physical Measurement Audit Trail
          </div>
          <div style={{ fontSize: 13, color: MUTED }}>
            Full history of physical weight and dimensional corrections synced to Helm WMS.
          </div>
        </div>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            style={{
              border: '1px solid #CBD5E1', background: '#F8FAFC',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700,
              color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <X size={14} /> Clear All Filters
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12, marginBottom: 20, padding: 14,
        background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0'
      }}>
        {/* General Search */}
        <div style={{ position: 'relative' }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search keyword..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 32px', borderRadius: 8,
              border: '1px solid #CBD5E1', fontSize: 12.5, fontFamily: 'inherit', background: '#fff'
            }}
          />
        </div>

        {/* SKU Filter */}
        <div style={{ position: 'relative' }}>
          <Tag size={15} color={MUTED} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Filter by SKU..."
            value={skuFilter}
            onChange={(e) => { setSkuFilter(e.target.value); setPage(0); }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 32px', borderRadius: 8,
              border: '1px solid #CBD5E1', fontSize: 12.5, fontFamily: 'inherit', background: '#fff'
            }}
          />
        </div>

        {/* User / Operator Filter */}
        <div style={{ position: 'relative' }}>
          <User size={15} color={MUTED} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Filter by User / Operator..."
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value); setPage(0); }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 32px', borderRadius: 8,
              border: '1px solid #CBD5E1', fontSize: 12.5, fontFamily: 'inherit', background: '#fff'
            }}
          />
        </div>

        {/* From Date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
            style={{
              flex: 1, boxSizing: 'border-box',
              padding: '6px 8px', borderRadius: 8,
              border: '1px solid #CBD5E1', fontSize: 12, fontFamily: 'inherit', background: '#fff'
            }}
          />
        </div>

        {/* To Date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
            style={{
              flex: 1, boxSizing: 'border-box',
              padding: '6px 8px', borderRadius: 8,
              border: '1px solid #CBD5E1', fontSize: 12, fontFamily: 'inherit', background: '#fff'
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
          <div>Loading audit records...</div>
        </div>
      ) : logs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>
          No measurement records found {hasActiveFilters ? 'matching your filters.' : 'yet.'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '2px solid #E2E8F0', fontSize: 11.5 }}>
                  <th style={{ padding: '10px 12px' }}>Timestamp</th>
                  <th style={{ padding: '10px 12px' }}>Customer</th>
                  <th style={{ padding: '10px 12px' }}>Product / SKU</th>
                  <th style={{ padding: '10px 12px' }}>Old Weight</th>
                  <th style={{ padding: '10px 12px' }}>New Weight</th>
                  <th style={{ padding: '10px 12px' }}>Dimensions (L×W×H)</th>
                  <th style={{ padding: '10px 12px' }}>Updated By</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const dateStr = new Date(log.created_at).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                  });
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '12px 12px', color: MUTED, whiteSpace: 'nowrap' }}>
                        {dateStr}
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: 600, color: TITLE }}>
                        {log.customer_name || '—'}
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        <div style={{ fontWeight: 700, color: TITLE }}>{log.sku}</div>
                        <div style={{ fontSize: 11.5, color: MUTED }}>{log.product_name}</div>
                      </td>
                      <td style={{ padding: '12px 12px', color: MUTED }}>
                        {log.old_weight != null ? `${log.old_weight} ${log.weight_unit}` : '—'}
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: 700, color: '#047857' }}>
                        {log.new_weight} {log.weight_unit}
                      </td>
                      <td style={{ padding: '12px 12px', color: TITLE }}>
                        {log.new_length != null ? `${log.new_length}×${log.new_width}×${log.new_height} cm` : '—'}
                      </td>
                      <td style={{ padding: '12px 12px', color: MUTED }}>
                        <div style={{ fontWeight: 600, color: TITLE }}>{log.user_name || 'Operator'}</div>
                        <div style={{ fontSize: 11 }}>{log.user_email}</div>
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 700, borderRadius: 5, padding: '2px 7px',
                          background: log.status === 'synced' ? '#ECFDF5' : (log.status === 'failed' ? '#FEF2F2' : '#EFF6FF'),
                          color: log.status === 'synced' ? '#065F46' : (log.status === 'failed' ? '#991B1B' : '#1D4ED8')
                        }}>
                          {log.status === 'synced' ? '✓ Synced' : log.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: 12, color: MUTED }}>
                Showing {page * limit + 1}–{Math.min(total, (page + 1) * limit)} of {total} records
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  style={{
                    border: '1px solid #CBD5E1', background: '#fff',
                    borderRadius: 6, padding: '5px 12px', fontSize: 12,
                    cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  style={{
                    border: '1px solid #CBD5E1', background: '#fff',
                    borderRadius: 6, padding: '5px 12px', fontSize: 12,
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const dimInputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #CBD5E1', borderRadius: 8,
  padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
  marginTop: 4, background: '#fff'
};
