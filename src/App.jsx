import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Radar, Smartphone, MapPin, Volume2, Loader } from 'lucide-react';
import './index.css';

// --- Web Audio API for Radar Beep ---
const playBeep = (audioCtx, volume, frequency = 880) => {
  if (!audioCtx) return;
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  
  gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.5);
};

// --- Haversine Formula for Distance Calculation ---
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of the earth in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; 
}

export default function App() {
  const [loading, setLoading] = useState(false);

  // App State
  const [view, setView] = useState('dashboard'); // dashboard, target, seeker
  const [deviceName, setDeviceName] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [targetDeviceId, setTargetDeviceId] = useState(null);
  
  // Data
  const [devices, setDevices] = useState([]);
  const [myLocation, setMyLocation] = useState(null);
  const [targetLocation, setTargetLocation] = useState(null);
  const [distance, setDistance] = useState(null);

  const audioCtxRef = useRef(null);
  const intervalRef = useRef(null);
  const watchIdRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    const { data, error } = await supabase.from('devices').select('*');
    if (data) setDevices(data);
  };

  const startAsTarget = async () => {
    if (!deviceName) return alert("Masukkan nama perangkat");
    setLoading(true);
    
    // Create device in DB (no auth required)
    const { data, error } = await supabase
      .from('devices')
      .insert([{ device_name: deviceName }])
      .select()
      .single();
      
    if (error) {
      console.error(error);
      alert("Gagal menyimpan perangkat ke database!");
      setLoading(false);
      return;
    }
    
    setCurrentDeviceId(data.id);
    setView('target');
    setLoading(false);

    // Start sending location
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          setMyLocation({ lat, lon });
          
          await supabase
            .from('devices')
            .update({ latitude: lat, longitude: lon, updated_at: new Date() })
            .eq('id', data.id);
        },
        (error) => console.error("Error getting location", error),
        { enableHighAccuracy: true }
      );
    } else {
      alert("Browser Anda tidak mendukung pelacakan lokasi GPS.");
    }
  };

  const startAsSeeker = (id) => {
    setTargetDeviceId(id);
    setView('seeker');
    
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }

    // Watch own location
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setMyLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        },
        (error) => console.error("Error getting location", error),
        { enableHighAccuracy: true }
      );
    }

    // Clean up previous channel if it exists
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Subscribe to target device updates
    channelRef.current = supabase
      .channel(`device-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
          filter: `id=eq.${id}`
        },
        (payload) => {
          if (payload.new.latitude && payload.new.longitude) {
            setTargetLocation({ lat: payload.new.latitude, lon: payload.new.longitude });
          }
        }
      )
      .subscribe();
      
    // Initial fetch for target location
    supabase.from('devices').select('latitude, longitude').eq('id', id).single().then(({data}) => {
      if (data && data.latitude) setTargetLocation({ lat: data.latitude, lon: data.longitude });
    });
  };

  // Logic for Seeker audio feedback
  useEffect(() => {
    if (view === 'seeker' && myLocation && targetLocation) {
      const dist = getDistanceFromLatLonInMeters(myLocation.lat, myLocation.lon, targetLocation.lat, targetLocation.lon);
      setDistance(dist);
      
      // Clear previous interval
      if (intervalRef.current) clearInterval(intervalRef.current);
      
      // Determine beep rate and volume based on distance
      let intervalMs = 2000;
      let volume = 0.1;
      
      if (dist < 5) {
        intervalMs = 200; volume = 1.0;
      } else if (dist < 15) {
        intervalMs = 500; volume = 0.8;
      } else if (dist < 30) {
        intervalMs = 1000; volume = 0.5;
      } else if (dist < 100) {
        intervalMs = 1500; volume = 0.3;
      }

      intervalRef.current = setInterval(() => {
        playBeep(audioCtxRef.current, volume);
      }, intervalMs);
    }
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [myLocation, targetLocation, view]);

  const goBackToDashboard = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (watchIdRef.current && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setView('dashboard');
    setTargetLocation(null);
    setDistance(null);
    fetchDevices();
  };

  if (loading) {
    return <div className="app-container justify-center items-center"><Loader className="animate-spin text-cyan" size={40} /></div>;
  }

  return (
    <div className="app-container">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar className="text-cyan" size={24} />
          <h3 className="text-sm">Find Your Phone</h3>
        </div>
      </header>

      {view === 'dashboard' && (
        <div className="flex flex-col gap-4">
          <div className="glass-card">
            <h4 className="mb-2 flex items-center gap-2"><Smartphone size={18} className="text-cyan"/> Jadikan Perangkat Ini Target</h4>
            <p className="text-sm text-secondary mb-4">Daftarkan perangkat ini agar bisa dilacak oleh perangkat lain.</p>
            <div className="flex gap-2">
              <input 
                type="text" 
                className="input-field flex-1" 
                placeholder="Nama Perangkat (Mis: iPhone Budi)" 
                value={deviceName} 
                onChange={e => setDeviceName(e.target.value)} 
              />
              <button className="btn btn-primary" onClick={startAsTarget}>Mulai</button>
            </div>
          </div>

          <div className="glass-card">
            <h4 className="mb-2 flex items-center gap-2"><MapPin size={18} className="text-blue-500"/> Lacak Perangkat Lain</h4>
            <p className="text-sm text-secondary mb-4">Pilih perangkat yang ingin Anda cari dari daftar di bawah ini.</p>
            
            <div className="flex flex-col gap-2">
              {devices.length === 0 ? (
                <p className="text-sm text-secondary text-center py-4">Belum ada perangkat terdaftar.</p>
              ) : (
                devices.map(dev => (
                  <div key={dev.id} className="flex items-center justify-between p-3 border border-[rgba(255,255,255,0.05)] rounded-md bg-[rgba(0,0,0,0.2)]">
                    <div>
                      <div className="font-medium text-sm">{dev.device_name}</div>
                      <div className="text-xs text-secondary">Diperbarui: {new Date(dev.updated_at).toLocaleTimeString()}</div>
                    </div>
                    <button className="btn btn-primary" style={{padding: '0.4rem 0.8rem', fontSize: '0.8rem'}} onClick={() => startAsSeeker(dev.id)}>Cari</button>
                  </div>
                ))
              )}
            </div>
            <button className="btn w-full mt-4 border border-[rgba(255,255,255,0.1)] text-sm" onClick={fetchDevices}>Refresh Daftar</button>
          </div>
        </div>
      )}

      {view === 'target' && (
        <div className="glass-card text-center mt-8">
          <div className="radar-container mx-auto">
            <div className="radar-circle"></div>
            <div className="radar-circle"></div>
            <div className="radar-circle"></div>
            <div className="radar-center"></div>
          </div>
          <h3 className="text-cyan mb-2">Memancarkan Sinyal</h3>
          <p className="text-sm text-secondary">Perangkat ini sekarang sedang melacak lokasinya dan siap dicari.</p>
          {myLocation && (
            <div className="mt-4 text-xs text-secondary opacity-50">
              {myLocation.lat.toFixed(6)}, {myLocation.lon.toFixed(6)}
            </div>
          )}
          <button className="btn mt-6 border border-[rgba(255,255,255,0.1)]" onClick={goBackToDashboard}>Berhenti & Kembali</button>
        </div>
      )}

      {view === 'seeker' && (
        <div className="glass-card text-center mt-8">
          <h3 className="mb-4">Mencari Perangkat</h3>
          
          <div className={`radar-container mx-auto ${distance && distance < 10 ? 'scale-110 transition-transform' : ''}`}>
            <div className="radar-circle" style={{animationDuration: distance ? `${Math.max(0.5, distance / 20)}s` : '3s'}}></div>
            <div className="radar-circle" style={{animationDuration: distance ? `${Math.max(0.5, distance / 20)}s` : '3s', animationDelay: '0.3s'}}></div>
            <div className="radar-center" style={{transform: distance && distance < 10 ? 'scale(1.5)' : 'scale(1)', transition: '0.3s'}}></div>
          </div>

          <div className="mb-4">
            <div className="text-sm text-secondary">Jarak Estimasi:</div>
            <div className="text-3xl font-bold text-cyan mt-1">
              {distance !== null ? `${Math.round(distance)}m` : 'Menghitung...'}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-secondary mb-6">
            <Volume2 size={16} className={distance && distance < 15 ? 'text-cyan' : ''} />
            <span>Volume Radar: {distance !== null ? (distance < 5 ? 'Maksimal' : distance < 15 ? 'Tinggi' : 'Sedang') : '...'}</span>
          </div>

          <button className="btn border border-[rgba(255,255,255,0.1)]" onClick={goBackToDashboard}>Berhenti & Kembali</button>
        </div>
      )}
    </div>
  );
}
