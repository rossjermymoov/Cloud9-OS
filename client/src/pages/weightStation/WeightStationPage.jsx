import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scale, ScanBarcode, CheckCircle2, AlertCircle, AlertTriangle, History, Search,
  RefreshCw, Box, Layers, X, ChevronRight, Database, Square,
  Calendar, Filter, User, Tag, Zap, Usb, Check, ArrowRight, Ruler
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

  // Already Scanned detection state & audio feedback
  const [alreadyScannedNotice, setAlreadyScannedNotice] = useState(null);
  const alreadyScannedTimerRef = useRef(null);

  function playWarningBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(340, ctx.currentTime);
      osc.frequency.setValueAtTime(240, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  function playSuccessChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.1); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }

  // USB Scale & Hands-Free Automation Settings
  const [usbScaleDevice, setUsbScaleDevice] = useState(null);
  const [usbScaleConnected, setUsbScaleConnected] = useState(false);
  const [usbScaleName, setUsbScaleName] = useState('');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);

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
  const [scaleMustClear, setScaleMustClear] = useState(false);
  const scaleMustClearRef = useRef(false);
  const selectedProductRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const autoSyncTimeoutRef = useRef(null);

  // Success and Error feedback state
  const [successToast, setSuccessToast] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  // Focus management for barcode scanner & weight box
  const barcodeInputRef = useRef(null);
  const weightInputRef = useRef(null);

  // Dimensions Pop-Up Prompt State (3s prompt on scale stabilization)
  const [dimPromptState, setDimPromptState] = useState(null); // null | 'asking' | 'entering'
  const dimPromptStateRef = useRef(null);
  const [dimCountdown, setDimCountdown] = useState(3);
  const dimTimerRef = useRef(null);
  const dimIntervalRef = useRef(null);
  const dimLengthRef = useRef(null);
  const stabilizingRef = useRef(false);
  const stabilizedRef = useRef(false);

  // ── WebHID & WebSerial USB Scale Integration (My Weigh UltraShip U2) ──────
  const [serialPort, setSerialPort] = useState(null);
  const serialReaderRef = useRef(null);

  async function connectUsbScale() {
    if (!('hid' in navigator)) {
      alert('WebHID is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    try {
      // Pass filters: [] so Chrome displays ALL connected USB HID devices without filtering
      const devices = await navigator.hid.requestDevice({ filters: [] });
      if (!devices || devices.length === 0) return;

      const device = devices[0];
      await attachUsbScale(device);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('USB scale connection failed:', err);
        alert(`Could not connect USB scale: ${err.message}`);
      }
    }
  }

  async function connectUsbSerial() {
    if (!('serial' in navigator)) {
      alert('WebSerial is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    try {
      const port = await navigator.serial.requestPort({ filters: [] });
      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
      setSerialPort(port);
      setUsbScaleConnected(true);
      setUsbScaleName('UltraShip U2 (Serial/COM)');

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable).catch(() => {});
      const reader = textDecoder.readable.getReader();
      serialReaderRef.current = reader;

      let buffer = '';
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += value;
              const lines = buffer.split(/[\r\n]+/);
              buffer = lines.pop(); // keep partial line
              for (const line of lines) {
                parseSerialWeight(line);
              }
            }
          }
        } catch (e) {
          console.warn('Serial stream read error:', e);
        }
      })();
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('Serial connection failed:', err);
        alert(`Could not connect Serial port: ${err.message}`);
      }
    }
  }

  function parseSerialWeight(line) {
    if (!line || !line.trim()) return;
    // Match common scale formats: e.g. "ST,GS,+000.450kg", "125.4 g", "0.45 kg", "1.25 lb"
    const clean = line.replace(/[^0-9.\-a-zA-Z]/g, ' ').trim();
    const match = clean.match(/([+-]?[0-9]+(?:\.[0-9]+)?)\s*(kg|g|lb|lbs|oz)?/i);
    if (match) {
      let val = parseFloat(match[1]);
      let u = (match[2] || 'g').toLowerCase();
      if (isNaN(val)) return;
      if (val <= 0) {
        handleWeightChange('0');
        return;
      }

      if (u === 'kg') val = val * 1000;
      else if (u === 'lb' || u === 'lbs') val = val * 453.592;
      else if (u === 'oz') val = val * 28.3495;

      const finalVal = unit === 'kg' ? (val / 1000).toFixed(3) : Math.round(val);
      handleWeightChange(String(finalVal));
    }
  }

  const [lastRawPacket, setLastRawPacket] = useState('');

  async function attachUsbScale(device) {
    if (!device.opened) {
      await device.open();
    }

    setUsbScaleDevice(device);
    setUsbScaleConnected(true);
    setUsbScaleName(device.productName || 'My Weigh UltraShip U2');

    device.oninputreport = (event) => {
      parseHidScalePacket(event);
    };
  }

  function parseHidScalePacket(event) {
    const { data } = event;
    if (!data || data.byteLength === 0) return;

    // Convert to hex string for live diagnostics
    const hexArr = [];
    for (let i = 0; i < data.byteLength; i++) {
      hexArr.push(data.getUint8(i).toString(16).padStart(2, '0').toUpperCase());
    }
    const hexStr = hexArr.join(' ');
    console.log('[WebHID Scale Report]:', hexStr);

    // 1. Try ASCII text decode first if packet contains printable numbers
    try {
      const asciiText = new TextDecoder().decode(data.buffer);
      if (/[0-9]/.test(asciiText)) {
        const match = asciiText.match(/([+-]?[0-9]+(?:\.[0-9]+)?)\s*(kg|g|lb|lbs|oz)?/i);
        if (match) {
          let val = parseFloat(match[1]);
          let u = (match[2] || 'g').toLowerCase();
          if (!isNaN(val)) {
            if (val <= 0) {
              setLastRawPacket(`${hexStr} -> 0${unit}`);
              handleWeightChange('0');
              return;
            }
            if (u === 'kg') val = val * 1000;
            else if (u === 'lb' || u === 'lbs') val = val * 453.592;
            else if (u === 'oz') val = val * 28.3495;
            const finalVal = unit === 'kg' ? (val / 1000).toFixed(3) : Math.round(val);
            setLastRawPacket(`${hexStr} (ASCII: ${finalVal}${unit})`);
            handleWeightChange(String(finalVal));
            return;
          }
        }
      }
    } catch { /* not ascii */ }

    // 2. Standard USB POS Scale Report (HID Usage Page 0x8D)
    // Detect whether Report ID is byte 0 (offset 1) or omitted (offset 0)
    let bestOffset = -1;
    if (
      data.byteLength >= 6 &&
      [1, 2, 3, 4, 5, 6, 7, 8].includes(data.getUint8(1)) &&
      [2, 3, 11, 12, 0x02, 0x03, 0x0B, 0x0C].includes(data.getUint8(2))
    ) {
      bestOffset = 1;
    } else if (
      data.byteLength >= 5 &&
      [1, 2, 3, 4, 5, 6, 7, 8].includes(data.getUint8(0)) &&
      [2, 3, 11, 12, 0x02, 0x03, 0x0B, 0x0C].includes(data.getUint8(1))
    ) {
      bestOffset = 0;
    }

    if (bestOffset !== -1) {
      const status = data.getUint8(bestOffset);
      const uCode = data.getUint8(bestOffset + 1);
      const exp = data.getInt8(bestOffset + 2);
      const raw = data.getUint16(bestOffset + 3, true);

      // Status: 2 = Center of Zero, 5 = Under Zero, or raw weight is 0
      if (status === 2 || status === 5 || raw === 0) {
        setLastRawPacket(`${hexStr} -> 0${unit}`);
        handleWeightChange('0');
        return;
      }

      if (exp >= -4 && exp <= 3) {
        let calc = raw * Math.pow(10, exp);
        if (uCode === 11 || uCode === 0x0B) calc *= 28.3495;
        else if (uCode === 12 || uCode === 0x0C) calc *= 453.592;
        else if (uCode === 3 || uCode === 0x03) calc *= 1000;

        if (calc >= 0 && calc < 500000) {
          const finalDisplayVal = unit === 'kg' ? (calc / 1000).toFixed(3) : Math.round(calc);
          setLastRawPacket(`${hexStr} -> ${finalDisplayVal}${unit}`);
          handleWeightChange(String(finalDisplayVal));
          return;
        }
      }
    }

    setLastRawPacket(`${hexStr} (${data.byteLength} bytes)`);
  }

  // Auto-reconnect previously authorized USB scales on mount
  useEffect(() => {
    if ('hid' in navigator) {
      navigator.hid.getDevices().then((devices) => {
        if (devices && devices.length > 0) {
          attachUsbScale(devices[0]).catch(() => {});
        }
      });
    }
  }, []);

  function disconnectUsbScale() {
    if (usbScaleDevice && usbScaleDevice.opened) {
      usbScaleDevice.close().catch(() => {});
    }
    if (serialReaderRef.current) {
      serialReaderRef.current.cancel().catch(() => {});
      serialReaderRef.current = null;
    }
    if (serialPort) {
      serialPort.close().catch(() => {});
      setSerialPort(null);
    }
    setUsbScaleDevice(null);
    setUsbScaleConnected(false);
    setUsbScaleName('');
  }

  // Reset station state
  function resetStation() {
    selectedProductRef.current = null;
    setSelectedProduct(null);
    setSearchResults([]);
    setSearchError(null);
    setUpdateError(null);
    setAlreadyScannedNotice(null);
    setBarcodeInput('');
    setEnteredWeight('');
    setEnteredLength('');
    setEnteredWidth('');
    setEnteredHeight('');
    setNotes('');
    setStabilized(false);
    setStabilizing(false);
    setIsAutoSyncing(false);
    setCountdown(0);
    candidateWeightRef.current = null;
    isUpdatingRef.current = false;
    closeDimPrompt();
    clearInterval(countdownIntervalRef.current);
    clearTimeout(debounceTimerRef.current);
    clearTimeout(autoSyncTimeoutRef.current);
    if (alreadyScannedTimerRef.current) clearTimeout(alreadyScannedTimerRef.current);

    // If scale is empty or 0 right now, clear the lock flag immediately
    const live = parseFloat(currentLiveWeightRef.current);
    if (isNaN(live) || live <= (unit === 'kg' ? 0.002 : 2)) {
      scaleMustClearRef.current = false;
      setScaleMustClear(false);
    }

    setTimeout(() => {
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    }, 80);
  }

  // Keep selectedProductRef in sync with state
  useEffect(() => {
    selectedProductRef.current = selectedProduct;
  }, [selectedProduct]);

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

    if (alreadyScannedTimerRef.current) clearTimeout(alreadyScannedTimerRef.current);
    setAlreadyScannedNotice(null);
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
        const prod = items[0];
        // If this product was already flagged as already-weighed and the user scans it again,
        // treat the second scan as confirmation to re-weigh!
        if (prod.already_weighed && alreadyScannedNotice?.sku === prod.sku) {
          if (alreadyScannedTimerRef.current) clearTimeout(alreadyScannedTimerRef.current);
          setAlreadyScannedNotice(null);
          scaleMustClearRef.current = false;
          setScaleMustClear(false);
          selectProduct(prod);
          return;
        }

        if (prod.already_weighed) {
          playWarningBeep();
          setAlreadyScannedNotice({
            sku: prod.sku,
            name: prod.name,
            customer: prod.customer_name,
            weight: prod.last_logged_weight != null ? prod.last_logged_weight : prod.weight_g,
            unit: prod.last_logged_unit || 'g',
            user: prod.last_weighed_by,
            date: prod.last_weighed_at ? new Date(prod.last_weighed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'previously',
            prod: prod
          });
          setBarcodeInput('');
          setTimeout(() => {
            if (barcodeInputRef.current) barcodeInputRef.current.focus();
          }, 50);
        } else {
          selectProduct(prod);
        }
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

  // Stable tracking refs
  const candidateWeightRef = useRef(null);
  const currentLiveWeightRef = useRef('');
  const isUpdatingRef = useRef(false);

  // Clear all stabilization timers & state
  function clearStabilization() {
    candidateWeightRef.current = null;
    setStabilizing(false);
    setStabilized(false);
    setIsAutoSyncing(false);
    setCountdown(0);
    stabilizingRef.current = false;
    stabilizedRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (autoSyncTimeoutRef.current) clearTimeout(autoSyncTimeoutRef.current);
  }

  // Start exact 3.0s stabilization countdown
  function startStabilization(targetNum) {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (autoSyncTimeoutRef.current) clearTimeout(autoSyncTimeoutRef.current);

    candidateWeightRef.current = targetNum;
    stabilizingRef.current = true;
    stabilizedRef.current = false;
    setStabilized(false);
    setStabilizing(true);
    setCountdown('3.0');

    const startTime = Date.now();
    const totalDuration = 3000; // 3.0 seconds stabilization countdown

    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, (totalDuration - elapsed) / 1000);
      setCountdown(remaining.toFixed(1));
      if (elapsed >= totalDuration) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 100);

    debounceTimerRef.current = setTimeout(() => {
      stabilizingRef.current = false;
      stabilizedRef.current = true;
      setStabilizing(false);
      setStabilized(true);
      setCountdown(0);

      // 3 seconds complete: directly pop up "Do you want to enter dimensions?"!
      triggerDimPrompt();
    }, totalDuration);
  }

  function selectProduct(prod) {
    if (alreadyScannedTimerRef.current) clearTimeout(alreadyScannedTimerRef.current);
    setAlreadyScannedNotice(null);
    scaleMustClearRef.current = false;
    setScaleMustClear(false);
    selectedProductRef.current = prod;
    setSelectedProduct(prod);
    setSearchResults([]);
    setSearchError(null);
    setUpdateError(null);
    setBarcodeInput('');
    setEnteredLength(prod.length ? String(prod.length) : '');
    setEnteredWidth(prod.width ? String(prod.width) : '');
    setEnteredHeight(prod.height ? String(prod.height) : '');

    // Reset weight and stabilization state completely when a barcode is entered.
    clearStabilization();
    closeDimPrompt();
    setEnteredWeight('');

    // If an item is ALREADY physically on the scale before scanning
    const liveWeight = parseFloat(currentLiveWeightRef.current);
    const hasLiveWeight = !isNaN(liveWeight) && liveWeight > (unit === 'kg' ? 0.002 : 2);
    if (hasLiveWeight) {
      setEnteredWeight(currentLiveWeightRef.current);
      startStabilization(liveWeight);
    }

    // Auto-focus the live weight input box immediately
    setTimeout(() => {
      if (weightInputRef.current) {
        weightInputRef.current.focus();
        weightInputRef.current.select();
      }
    }, 80);
  }

  // Weight input handler with 3.0s stabilization
  function handleWeightChange(val) {
    currentLiveWeightRef.current = val;
    const num = parseFloat(val);

    // If scale drops to zero or empty pan (<= 2 grams or <= 0.002 kg)
    const isZero = isNaN(num) || (unit === 'kg' ? num <= 0.002 : num <= 2);
    if (isZero) {
      scaleMustClearRef.current = false;
      setScaleMustClear(false);
      if (selectedProductRef.current) {
        setEnteredWeight('');
        clearStabilization();
        closeDimPrompt();
      }
      return;
    }

    // If no product is currently selected, do not run stabilization timers
    if (!selectedProductRef.current) {
      return;
    }

    // If previous item hasn't been removed yet from scale, ignore weight until removed
    if (scaleMustClearRef.current) {
      return;
    }

    // CRITICAL: If the dimensions dialog is already active (asking or entering),
    // incoming scale jitter MUST NOT touch it or close it!
    if (dimPromptStateRef.current !== null) {
      return;
    }

    // Product is selected and a valid item is on the scale:
    setEnteredWeight(val);
    setUpdateError(null);

    // If we are currently stabilizing, update the candidate weight to track settling,
    // but DO NOT restart the 3.0s timer for micro-jitter!
    // Only restart if the weight changed drastically (e.g. item swapped, > 100g or > 50%).
    if (stabilizingRef.current) {
      const prev = candidateWeightRef.current;
      const isHugeChange = prev !== null && Math.abs(num - prev) > Math.max(100, prev * 0.5);
      if (isHugeChange) {
        startStabilization(num);
      }
      return;
    }

    // If already stabilized, don't restart unless item was swapped for a different weight
    if (stabilizedRef.current) {
      const prev = candidateWeightRef.current;
      const isHugeChange = prev !== null && Math.abs(num - prev) > Math.max(100, prev * 0.5);
      if (isHugeChange) {
        startStabilization(num);
      }
      return;
    }

    // Item placed on scale: start the 3.0s stabilization countdown
    startStabilization(num);
  }

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: updateProductWeight,
    onMutate: () => {
      isUpdatingRef.current = true;
    },
    onSuccess: (res) => {
      isUpdatingRef.current = false;
      playSuccessChime();
      setUpdateError(null);
      qc.invalidateQueries({ queryKey: ['weight-station-logs'] });
      setSuccessToast({
        sku: selectedProduct?.sku,
        name: selectedProduct?.name,
        newWeight: `${res.weight_g} g (${res.weight_kg} kg)`,
        customer: selectedProduct?.customer_name
      });
      setTimeout(() => setSuccessToast(null), 3000);
      scaleMustClearRef.current = true;
      setScaleMustClear(true);
      resetStation();
    },
    onError: (err) => {
      isUpdatingRef.current = false;
      const msg = err?.response?.data?.error || err.message || 'Helm update rejected the request';
      setUpdateError(msg);
      setIsAutoSyncing(false);
    }
  });

  function handleSubmitUpdate(options = {}) {
    if (options && typeof options.preventDefault === 'function') options.preventDefault();
    if (!selectedProduct || updateMutation.isPending || isUpdatingRef.current) return;
    const finalWeight = parseFloat(enteredWeight);
    if (isNaN(finalWeight) || finalWeight <= 0) {
      alert('Please enter a valid weight from the scale.');
      return;
    }

    const withDims = options?.withDims === true;

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
      new_length: withDims && enteredLength ? parseFloat(enteredLength) : null,
      new_width: withDims && enteredWidth ? parseFloat(enteredWidth) : null,
      new_height: withDims && enteredHeight ? parseFloat(enteredHeight) : null,
      old_length: selectedProduct.length,
      old_width: selectedProduct.width,
      old_height: selectedProduct.height,
      dimension_unit: 'cm',
      notes
    });
  }

  // ── Dimensions Prompt Logic ──────────────────────────────────────────────
  function closeDimPrompt() {
    if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    if (dimIntervalRef.current) clearInterval(dimIntervalRef.current);
    dimPromptStateRef.current = null;
    setDimPromptState(null);
  }

  function triggerDimPrompt() {
    if (dimPromptStateRef.current !== null) return;
    dimPromptStateRef.current = 'asking';
    setDimPromptState('asking');
    setDimCountdown(3);

    if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    if (dimIntervalRef.current) clearInterval(dimIntervalRef.current);

    const startTime = Date.now();
    const duration = 3000; // 3 seconds pop-up

    dimIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const left = Math.max(0, Math.ceil((duration - elapsed) / 1000));
      setDimCountdown(left);
      if (elapsed >= duration) {
        clearInterval(dimIntervalRef.current);
      }
    }, 100);

    dimTimerRef.current = setTimeout(() => {
      // 3 seconds elapsed: automatically close pop-up and save weight only!
      closeDimPrompt();
      handleSubmitUpdate({ withDims: false });
    }, duration);
  }

  function handleAcceptDims() {
    // Interrupted by Enter! Stop the 3-second countdown timer immediately
    if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    if (dimIntervalRef.current) clearInterval(dimIntervalRef.current);
    dimPromptStateRef.current = 'entering';
    setDimPromptState('entering');
    setTimeout(() => {
      if (dimLengthRef.current) {
        dimLengthRef.current.focus();
        dimLengthRef.current.select();
      }
    }, 80);
  }

  function handleDeclineDims() {
    closeDimPrompt();
    handleSubmitUpdate({ withDims: false });
  }

  function handleSaveWithDims(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    closeDimPrompt();
    handleSubmitUpdate({ withDims: true });
  }

  // Keyboard shortcut listener when asking for dimensions:
  // "Enter" / "Return" = Interrupt countdown and open dimensions fields
  // "Escape" = No (save weight only)
  useEffect(() => {
    if (dimPromptState !== 'asking') return;

    function handleAskingKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleAcceptDims();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDeclineDims();
      }
    }

    window.addEventListener('keydown', handleAskingKeyDown, true);
    return () => window.removeEventListener('keydown', handleAskingKeyDown, true);
  }, [dimPromptState]);

  // Keyboard shortcut listener when entering dimensions:
  // "Escape" = Cancel and save weight only
  useEffect(() => {
    if (dimPromptState !== 'entering') return;

    function handleEnteringKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDeclineDims();
      }
    }

    window.addEventListener('keydown', handleEnteringKeyDown, true);
    return () => window.removeEventListener('keydown', handleEnteringKeyDown, true);
  }, [dimPromptState]);

  // ── ⚡ Scale Stabilization (3s stabilized) -> Prompt for Dimensions ────────
  useEffect(() => {
    if (
      autoSyncEnabled &&
      stabilized &&
      selectedProduct &&
      !updateMutation.isPending &&
      !isUpdatingRef.current &&
      enteredWeight &&
      parseFloat(enteredWeight) > 0 &&
      dimPromptState === null
    ) {
      triggerDimPrompt();
    }
  }, [stabilized, autoSyncEnabled, selectedProduct, enteredWeight, dimPromptState]);

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
          {/* USB Scale Connect Button & Status */}
          {usbScaleConnected ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
              borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 700
            }}>
              <Usb size={15} color={GREEN} />
              <span>{usbScaleName} (Live)</span>
              <button
                onClick={disconnectUsbScale}
                style={{ background: 'none', border: 'none', color: '#065F46', cursor: 'pointer', padding: 0, marginLeft: 4 }}
                title="Disconnect USB scale"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={connectUsbScale}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: ACCENT, color: '#fff', border: 'none',
                  borderRadius: 10, padding: '6px 13px', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,86,251,0.2)'
                }}
                title="Connect My Weigh UltraShip U2 via standard USB HID"
              >
                <Usb size={14} /> Connect USB Scale
              </button>
              <button
                onClick={connectUsbSerial}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#fff', border: '1px solid #CBD5E1', color: TITLE,
                  borderRadius: 10, padding: '6px 11px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                }}
                title="Connect via Serial / Virtual COM Port"
              >
                COM / Serial Port
              </button>
            </div>
          )}

          {/* Hands-Free Auto-Sync Toggle */}
          <button
            onClick={() => setAutoSyncEnabled(prev => !prev)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: autoSyncEnabled ? '#EFF6FF' : '#F8FAFC',
              border: autoSyncEnabled ? '1px solid #BFDBFE' : '1px solid #CBD5E1',
              color: autoSyncEnabled ? ACCENT : MUTED,
              borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Automatically send Helm update once scale reading stabilizes"
          >
            <Zap size={14} color={autoSyncEnabled ? ACCENT : MUTED} />
            {autoSyncEnabled ? 'Hands-Free Auto-Sync: ON' : 'Auto-Sync: OFF'}
          </button>

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
          {/* Hands-Free Workflow Progress Bar */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
            background: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: SHADOW
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: !selectedProduct ? ACCENT : GREEN, fontWeight: 700, fontSize: 12.5 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: !selectedProduct ? ACCENT : '#ECFDF5',
                color: !selectedProduct ? '#fff' : GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11
              }}>
                {selectedProduct ? '✓' : '1'}
              </div>
              <span>1. Scan Barcode</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: selectedProduct && !enteredWeight ? ACCENT : (enteredWeight ? GREEN : MUTED), fontWeight: 700, fontSize: 12.5 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: selectedProduct && !enteredWeight ? ACCENT : (enteredWeight ? '#ECFDF5' : '#F1F5F9'),
                color: selectedProduct && !enteredWeight ? '#fff' : (enteredWeight ? GREEN : MUTED), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11
              }}>
                {enteredWeight ? '✓' : '2'}
              </div>
              <span>2. Place on Scale</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: stabilizing ? AMBER : (stabilized ? GREEN : MUTED), fontWeight: 700, fontSize: 12.5 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: stabilizing ? '#FEF3C7' : (stabilized ? '#ECFDF5' : '#F1F5F9'),
                color: stabilizing ? AMBER : (stabilized ? GREEN : MUTED), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11
              }}>
                {stabilized ? '✓' : '3'}
              </div>
              <span>3. Stabilize</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isAutoSyncing || updateMutation.isPending ? ACCENT : (stabilized && autoSyncEnabled ? GREEN : MUTED), fontWeight: 700, fontSize: 12.5 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: isAutoSyncing || updateMutation.isPending ? ACCENT : '#F1F5F9',
                color: isAutoSyncing || updateMutation.isPending ? '#fff' : MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11
              }}>
                4
              </div>
              <span>4. Auto-Push to Helm</span>
            </div>
          </div>

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
                  placeholder="Scan product barcode..."
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

          {/* ALREADY SCANNED WARNING BANNER */}
          {alreadyScannedNotice && (
            <div style={{
              background: '#FFFBEB', border: '2px solid #F59E0B', color: '#92400E',
              borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', boxShadow: '0 8px 24px rgba(245, 158, 11, 0.18)',
              gap: 16, flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14, background: '#FEF3C7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#D97706', flexShrink: 0
                }}>
                  <AlertTriangle size={30} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#92400E', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>This product has already been scanned!</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#FDE68A', color: '#78350F', padding: '3px 8px', borderRadius: 6 }}>
                      Synced to WMS
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: '#B45309', marginTop: 4 }}>
                    <strong>{alreadyScannedNotice.sku}</strong> ({alreadyScannedNotice.customer}) was recorded as <strong>{alreadyScannedNotice.weight} {alreadyScannedNotice.unit}</strong>
                    {alreadyScannedNotice.user ? ` by ${alreadyScannedNotice.user}` : ''} on {alreadyScannedNotice.date}.
                  </div>
                  <div style={{ fontSize: 12.5, color: '#D97706', marginTop: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Zap size={13} /> Click &ldquo;Re-weigh Product&rdquo; (or scan barcode again) to re-weigh. Or scan next item...
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    const p = alreadyScannedNotice?.prod;
                    setAlreadyScannedNotice(null);
                    if (p) selectProduct(p);
                  }}
                  style={{
                    background: '#fff', border: '1px solid #FCD34D', color: '#92400E',
                    borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 700,
                    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                  }}
                >
                  Re-weigh Product
                </button>
                <button
                  type="button"
                  onClick={() => setAlreadyScannedNotice(null)}
                  style={{ background: 'none', border: 'none', color: '#92400E', cursor: 'pointer', padding: 4 }}
                  title="Dismiss"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          )}

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
                      {prod.already_weighed ? (
                        <div style={{ fontSize: 11.5, color: '#059669', marginTop: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={13} color="#059669" /> Weighed: <strong>{prod.last_logged_weight} {prod.last_logged_unit || 'g'}</strong>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                          Current: <strong>{prod.weight_g} g</strong> ({prod.weight_kg} kg)
                        </div>
                      )}
                    </div>

                    <ChevronRight size={20} color="#94A3B8" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. PRODUCT SPOTLIGHT & SCALE WEIGHT CAPTURE STAGE */}
          {selectedProduct && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {selectedProduct.already_weighed && (
                <div style={{
                  background: '#FEF3C7', border: '2px solid #F59E0B', color: '#92400E',
                  borderRadius: 14, padding: '14px 18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.12)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <AlertTriangle size={22} color="#D97706" style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#B45309' }}>
                        ALREADY WEIGHED RECENTLY
                      </div>
                      <div style={{ fontSize: 13, color: '#78350F', marginTop: 2 }}>
                        Recorded as <strong>{selectedProduct.last_logged_weight != null ? selectedProduct.last_logged_weight : selectedProduct.weight_g} {selectedProduct.last_logged_unit || 'g'}</strong>
                        {selectedProduct.last_weighed_by ? ` by ${selectedProduct.last_weighed_by}` : ''} on {selectedProduct.last_weighed_at ? new Date(selectedProduct.last_weighed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently'}.
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, background: '#FDE68A', color: '#78350F', padding: '4px 10px', borderRadius: 8 }}>
                    Re-weigh active
                  </span>
                </div>
              )}

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

                {/* Previous weigh notification if already recorded */}
                {selectedProduct.already_weighed && (
                  <div style={{
                    marginTop: 10, background: '#FFFBEB', border: '1px solid #FCD34D',
                    borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#92400E',
                    display: 'flex', alignItems: 'flex-start', gap: 8
                  }}>
                    <AlertTriangle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <strong>Previously recorded:</strong> {selectedProduct.last_logged_weight != null ? selectedProduct.last_logged_weight : selectedProduct.weight_g} {selectedProduct.last_logged_unit || 'g'}
                      {selectedProduct.last_weighed_by ? ` by ${selectedProduct.last_weighed_by}` : ''}
                      {selectedProduct.last_weighed_at ? ` on ${new Date(selectedProduct.last_weighed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}.
                    </div>
                  </div>
                )}

                {/* Current Helm Weight Specs */}
                <div style={{ marginTop: 'auto', background: '#F8FAFC', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Current Recorded Weight in Helm
                  </div>
                  <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: TITLE }}>
                      {selectedProduct.weight_g != null ? selectedProduct.weight_g : 0} g <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>({selectedProduct.weight_kg != null ? selectedProduct.weight_kg : 0} kg)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: USB Scale Input & Helm Sync Form */}
              <div style={{ background: '#fff', borderRadius: 16, padding: 26, boxShadow: SHADOW, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Scale size={22} color={ACCENT} /> Live Scale Reading
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
                  {/* GIANT WEIGHT INPUT & STABILIZATION STATUS */}
                  <div style={{
                    background: '#F8FAFC', borderRadius: 16, padding: 20,
                    border: '2px solid',
                    borderColor: stabilized ? GREEN : (stabilizing ? AMBER : ACCENT),
                    transition: 'border-color 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: TITLE, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {usbScaleConnected && <Usb size={14} color={GREEN} />}
                        Scale Weight ({unit === 'g' ? 'Grams' : 'Kilograms'})
                      </label>
                      {scaleMustClear && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <AlertTriangle size={14} /> Remove previous item from scale
                        </span>
                      )}
                      {!scaleMustClear && !enteredWeight && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Scale size={14} /> Place item on scale...
                        </span>
                      )}
                      {stabilizing && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <RefreshCw size={13} className="animate-spin" /> Stabilizing ({countdown}s)...
                        </span>
                      )}
                      {stabilized && !isAutoSyncing && !updateMutation.isPending && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: GREEN, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <CheckCircle2 size={14} /> Scale reading locked &amp; stable
                        </span>
                      )}
                      {isAutoSyncing && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Zap size={14} className="animate-bounce" /> Auto-syncing to Helm...
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

                    {/* Live Scale Diagnostic Stream */}
                    {usbScaleConnected && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: MUTED, flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />
                          Scale Stream: <code style={{ fontFamily: 'ui-monospace, monospace', color: TITLE, background: '#fff', padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}>{lastRawPacket || 'Listening for packets...'}</code>
                        </span>
                        <span style={{ color: '#94A3B8' }}>Press SEND on scale if needed</span>
                      </div>
                    )}
                  </div>

                  {/* Operator Notes (Optional) */}
                  <input
                    type="text"
                    placeholder="Optional operator notes..."
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
                Scan any product barcode with your scanner. The product profile will be retrieved instantly for scale capture.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 3-Second Dimensions Pop-Up Modal ────────────────────────────── */}
      {dimPromptState === 'asking' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 24, maxWidth: 460, width: '100%',
            padding: '30px 32px 26px', boxShadow: '0 25px 60px -12px rgba(0,0,0,0.35)',
            border: '2px solid #E2E8F0', textAlign: 'center'
          }}>
            <div style={{
              width: 58, height: 58, borderRadius: 18, background: '#EFF6FF',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14, border: '1px solid #BFDBFE'
            }}>
              <Ruler size={30} color={ACCENT} />
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 800, color: TITLE, margin: '0 0 6px 0' }}>
              Do you want to enter dimensions?
            </h2>

            <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 16px 0' }}>
              Weight locked at <strong style={{ color: TITLE }}>{enteredWeight} {unit}</strong>
            </p>

            {/* Prominent Countdown Timer */}
            <div style={{
              background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 16,
              padding: '14px 20px', marginBottom: 20
            }}>
              <div style={{
                fontSize: 54, fontWeight: 900, color: ACCENT, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums'
              }}>
                {dimCountdown}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginTop: 4 }}>
                seconds until auto-saving weight
              </div>
              <div style={{
                width: '100%', height: 6, background: '#E2E8F0', borderRadius: 999,
                overflow: 'hidden', marginTop: 10
              }}>
                <div style={{
                  width: `${(dimCountdown / 3) * 100}%`, height: '100%',
                  background: ACCENT, transition: 'width 0.2s linear'
                }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
              <button
                type="button"
                autoFocus
                onClick={handleAcceptDims}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: '#059669', color: '#fff', border: 'none', borderRadius: 14,
                  padding: '14px 18px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)'
                }}
              >
                <span>Yes — Enter Dims</span>
                <span style={{
                  fontSize: 11, background: 'rgba(255,255,255,0.25)', padding: '2px 7px',
                  borderRadius: 4, fontWeight: 700
                }}>↵ Enter</span>
              </button>

              <button
                type="button"
                onClick={handleDeclineDims}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: '#F1F5F9', color: TITLE, border: '1px solid #CBD5E1',
                  borderRadius: 14, padding: '14px 16px', fontSize: 14.5, fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <span>Skip</span>
                <span style={{
                  fontSize: 11, background: '#E2E8F0', padding: '2px 7px',
                  borderRadius: 4, fontWeight: 700, color: MUTED
                }}>Esc</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {dimPromptState === 'entering' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, maxWidth: 480, width: '100%',
            padding: '28px 30px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            border: '1px solid #E2E8F0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ruler size={22} color={ACCENT} />
                <h3 style={{ fontSize: 19, fontWeight: 800, color: TITLE, margin: 0 }}>
                  Enter Package Dimensions
                </h3>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: '#EFF6FF', padding: '3px 8px', borderRadius: 6 }}>
                cm
              </span>
            </div>

            <p style={{ fontSize: 13, color: MUTED, margin: '0 0 18px 0' }}>
              Weight locked at <strong style={{ color: TITLE }}>{enteredWeight} {unit}</strong>. Press <strong style={{ color: TITLE }}>Enter ↵</strong> to save to Helm.
            </p>

            <form onSubmit={handleSaveWithDims}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: TITLE, marginBottom: 5 }}>
                    Length (cm)
                  </label>
                  <input
                    ref={dimLengthRef}
                    type="number"
                    step="0.1"
                    placeholder="L"
                    value={enteredLength}
                    onChange={(e) => setEnteredLength(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 10, border: '2px solid #CBD5E1', fontSize: 15,
                      fontWeight: 700, color: TITLE, outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: TITLE, marginBottom: 5 }}>
                    Width (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="W"
                    value={enteredWidth}
                    onChange={(e) => setEnteredWidth(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 10, border: '2px solid #CBD5E1', fontSize: 15,
                      fontWeight: 700, color: TITLE, outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: TITLE, marginBottom: 5 }}>
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="H"
                    value={enteredHeight}
                    onChange={(e) => setEnteredHeight(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 10, border: '2px solid #CBD5E1', fontSize: 15,
                      fontWeight: 700, color: TITLE, outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  type="submit"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: '#059669', color: '#fff', border: 'none', borderRadius: 12,
                    padding: '13px 18px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)'
                  }}
                >
                  <span>Save to Helm</span>
                  <span style={{
                    fontSize: 11, background: 'rgba(255,255,255,0.25)', padding: '2px 7px',
                    borderRadius: 4, fontWeight: 700
                  }}>↵ Enter</span>
                </button>

                <button
                  type="button"
                  onClick={handleDeclineDims}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: '#F1F5F9', color: TITLE, border: '1px solid #CBD5E1',
                    borderRadius: 12, padding: '13px 18px', fontSize: 15, fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <span>Save Weight Only</span>
                  <span style={{
                    fontSize: 11, background: '#E2E8F0', padding: '2px 7px',
                    borderRadius: 4, fontWeight: 700, color: MUTED
                  }}>Esc</span>
                </button>
              </div>
            </form>
          </div>
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

  const { data, isLoading } = useQuery({
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
