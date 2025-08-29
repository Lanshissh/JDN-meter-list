// components/SideNav.tsx
import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';

export type TabKey = 'admin' | 'scanner' | 'billing' | 'logout';

type Props = {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
};

function decodeRole(token: string | null): string {
  try {
    if (!token) return '';
    const p = token.split('.')[1];
    const base64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof (globalThis as any).atob === 'function' ? (globalThis as any).atob(base64) : '';
    return json ? String(JSON.parse(json)?.user_level || '').toLowerCase() : '';
  } catch {
    return '';
  }
}

export default function SideNav({ active, onSelect }: Props) {
  const { token } = useAuth();
  const role = useMemo(() => decodeRole(token), [token]);
  const canSeeAdmin = role !== 'reader';

  return (
    <View style={styles.sideNav}>
      <TouchableOpacity style={styles.iconBtn} onPress={() => onSelect(canSeeAdmin ? 'admin' : 'scanner')}>
        <Image source={require('../assets/images/jdn.jpg')} style={styles.logo} />
      </TouchableOpacity>

      <View style={styles.navSection}>
        {canSeeAdmin && (
          <TouchableOpacity
            style={[styles.iconBtn, active === 'admin' && styles.active]}
            onPress={() => onSelect('admin')}
          >
            <Ionicons name="person-circle-outline" size={28} color="#fff" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.iconBtn, active === 'scanner' && styles.active]}
          onPress={() => onSelect('scanner')}
        >
          <Ionicons name="scan-outline" size={28} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconBtn, active === 'billing' && styles.active]}
          onPress={() => onSelect('billing')}
        >
          <Ionicons name="card-outline" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.iconBtn} onPress={() => onSelect('logout')}>
        <Ionicons name="log-out-outline" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  sideNav: {
    width: 68,
    backgroundColor: '#082cac',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
    borderRightWidth: 1,
    borderRightColor: '#eee',
    flexDirection: 'column',
    height: '100%',
  },
  navSection: { flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 24 },
  iconBtn: { marginVertical: 6, alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 16 },
  logo: { width: 48, height: 48, borderRadius: 24, marginBottom: 16, borderWidth: 2, borderColor: '#fff' },
  active: { backgroundColor: 'rgba(255,255,255,0.15)' },
});