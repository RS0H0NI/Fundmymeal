import React, { useState, useEffect } from 'react';
import {
    StyleSheet, Text, View, FlatList, TouchableOpacity,
    ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform, Modal, ScrollView,
    StatusBar, SafeAreaView, ImageBackground
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';

const API_URL = 'http://192.168.0.156:8080';

function generateUID() {
    return 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

export default function HomeScreen() {
    const [restaurants, setRestaurants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeMode, setActiveMode] = useState('recipient');
    const [currentUserId, setCurrentUserId] = useState(null);
    const [currentUserName, setCurrentUserName] = useState('');
    const [allUsers, setAllUsers] = useState([]);
    const [userSwitcherVisible, setUserSwitcherVisible] = useState(false);
    const [bioInfo, setBioInfo] = useState('Checking...');
    const [regModalVisible, setRegModalVisible] = useState(false);
    const [newUserName, setNewUserName] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [donationModalVisible, setDonationModalVisible] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState(null);
    const [donationAmount, setDonationAmount] = useState('20');
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentStep, setPaymentStep] = useState('details'); // 'details' | 'processing' | 'success'
    const [cardDetails, setCardDetails] = useState({ number: '', expiry: '', cvc: '' });
    const [partnerForm, setPartnerForm] = useState({ name: '', description: '', initialFunds: '' });
    const [isRegisteringPartner, setIsRegisteringPartner] = useState(false);

    const fetchRestaurants = async () => {
        try {
            const res = await fetch(`${API_URL}/api/restaurants`);
            const data = await res.json();
            if (data.success) setRestaurants(data.restaurants);
        } catch (e) {
            console.warn('Network Error:', e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const loadProfiles = async () => {
            const id = await AsyncStorage.getItem('userId');
            const name = await AsyncStorage.getItem('userName');
            if (id) setCurrentUserId(id);
            if (name) setCurrentUserName(name);

            const saved = await AsyncStorage.getItem('registeredUsers');
            if (saved) {
                const parsed = JSON.parse(saved);
                setAllUsers(parsed);
                // If no user selected but we have users, pick the first one
                if (!id && parsed.length > 0) {
                    setCurrentUserId(parsed[0].id);
                    setCurrentUserName(parsed[0].name);
                    await AsyncStorage.multiSet([['userId', parsed[0].id], ['userName', parsed[0].name]]);
                }
            }
        };
        loadProfiles();

        LocalAuthentication.supportedAuthenticationTypesAsync().then(types => {
            const labels = types.map(t => t === 1 ? 'Fingerprint' : t === 2 ? 'FaceID' : `Type${t}`);
            setBioInfo(labels.length ? labels.join(', ') : 'None detected');
        });
        fetchRestaurants();
        const interval = setInterval(fetchRestaurants, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleRegisterUser = async () => {
        if (!newUserName.trim()) {
            Alert.alert('Name Required', 'Please enter your name.');
            return;
        }

        const nameToRegister = newUserName.trim();

        // Ensure hardware is available
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            Alert.alert('Hardware Error', 'Fingerprint sensor not detected or no fingerprints enrolled.');
            return;
        }

        // Auto-logout: Clear current session before registration
        setCurrentUserId(null);
        setCurrentUserName('');

        setRegModalVisible(false);
        await new Promise(r => setTimeout(r, 400));

        const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: `Authorize Registration (Use a finger saved in phone settings)`,
            fallbackLabel: 'Use Passcode',
        });

        if (!authResult.success) return;

        setIsRegistering(true);
        try {
            const newId = generateUID();
            const res = await fetch(`${API_URL}/api/auth/register-biometric`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: newId, biometricKey: 'native-verified-bypass' })
            });
            const data = await res.json();
            if (data.success) {
                const newUser = { id: newId, name: nameToRegister };
                const updatedUsers = [...allUsers, newUser];

                await AsyncStorage.setItem('registeredUsers', JSON.stringify(updatedUsers));
                await AsyncStorage.setItem('userId', newId);
                await AsyncStorage.setItem('userName', nameToRegister);

                setAllUsers(updatedUsers);
                setCurrentUserId(newId);
                setCurrentUserName(nameToRegister);
                setNewUserName('');
                Alert.alert('Success!', `${nameToRegister} is now registered and logged in.`);
            }
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setIsRegistering(false);
        }
    };

    const handleSwitchUser = async (user) => {
        setCurrentUserId(user.id);
        setCurrentUserName(user.name);
        await AsyncStorage.multiSet([['userId', user.id], ['userName', user.name]]);
        setUserSwitcherVisible(false);
    };

    const handleNativeClaim = async (restaurantId, maxFunds) => {
        if (maxFunds < 1) return Alert.alert('Empty', 'No meals available here.');
        if (!currentUserId) return Alert.alert('Register', 'Please tap "New User" first.');

        // Ensure hardware is available
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            Alert.alert('Hardware Error', 'Fingerprint sensor not available.');
            return;
        }

        const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Authorize Claim (Use any finger saved in phone settings)',
        });

        if (!authResult.success) return;

        try {
            const res = await fetch(`${API_URL}/api/auth/verify-and-claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUserId,
                    restaurantId,
                    biometricKey: 'native-verified-bypass',
                    amount: 20
                })
            });
            const data = await res.json();
            if (data.success) {
                Alert.alert('Verified!', 'Identity confirmed via Thumbprint sensor.');
                fetchRestaurants();
            } else {
                Alert.alert('Denied', data.error || 'Check daily limits.');
            }
        } catch (e) {
            Alert.alert('Error', e.message);
        }
    };

    const handleDonationSubmit = async () => {
        if (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvc) {
            Alert.alert('Missing Info', 'Please fill in all payment details.');
            return;
        }
        setPaymentStep('processing');

        // Mocking Stripe processing
        setTimeout(async () => {
            try {
                const amount = Number(donationAmount);
                const resp = await fetch(`${API_URL}/api/restaurants/donate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ restaurantId: selectedRestaurant.id, amount, donorId: currentUserId || 'donor_guest' })
                });
                const result = await resp.json();
                if (result.success) {
                    setPaymentStep('success');
                    fetchRestaurants();
                    setTimeout(() => {
                        setDonationModalVisible(false);
                        setPaymentStep('details');
                        setCardDetails({ number: '', expiry: '', cvc: '' });
                    }, 2000);
                } else {
                    Alert.alert('Failed', result.error);
                    setPaymentStep('details');
                }
            } catch (e) {
                Alert.alert('Error', e.message);
                setPaymentStep('details');
            }
        }, 2000);
    };

    const handleRegisterPartner = async () => {
        if (!partnerForm.name.trim()) return Alert.alert('Error', 'Name required.');
        setIsRegisteringPartner(true);
        try {
            const resp = await fetch(`${API_URL}/api/restaurants/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...partnerForm, initialFunds: Number(partnerForm.initialFunds) || 0, ownerId: currentUserId || 'partner_guest' })
            });
            if ((await resp.json()).success) {
                Alert.alert('Success', 'Welcome to the community!');
                setPartnerForm({ name: '', description: '', initialFunds: '' });
                fetchRestaurants();
                setActiveMode('recipient');
            }
        } finally {
            setIsRegisteringPartner(false);
        }
    };

    const renderRestaurant = ({ item }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <Text style={styles.restaurantName}>{item.name}</Text>
                <View style={[styles.badge, { backgroundColor: item.funds >= 20 ? 'rgba(5, 150, 105, 0.1)' : 'rgba(239, 68, 68, 0.1)' }]}>
                    <Text style={[styles.badgeText, { color: item.funds >= 20 ? '#059669' : '#ef4444' }]}>
                        {item.funds >= 20 ? 'AVAILABLE' : 'LOW FUNDS'}
                    </Text>
                </View>
            </View>

            <View style={styles.statsRow}>
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>COMMUNITY POOL</Text>
                    <Text style={[styles.statValue, { color: '#059669' }]}>${item.funds}</Text>
                </View>
                <View style={[styles.divider, { height: '80%' }]} />
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>MEALS SERVED</Text>
                    <Text style={styles.statValue}>{item.mealsServed || 0}</Text>
                </View>
            </View>

            {activeMode === 'donor' ? (
                <TouchableOpacity onPress={() => { setSelectedRestaurant(item); setDonationModalVisible(true); }}>
                    <View style={[styles.actionButton, { backgroundColor: '#059669' }]}>
                        <Ionicons name="heart" size={18} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={styles.actionButtonText}>Support this Community</Text>
                    </View>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                    disabled={item.funds < 1}
                    onPress={() => handleNativeClaim(item.id, item.funds)}
                    style={[styles.actionButton, item.funds < 1 && styles.disabledButton, { backgroundColor: '#111827' }]}
                >
                    <MaterialCommunityIcons name="fingerprint" size={20} color={item.funds < 1 ? '#9ca3af' : '#fff'} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionButtonText, item.funds < 1 && { color: '#9ca3af' }]}>
                        {item.funds < 1 ? 'Funds Exhausted' : 'Claim Meal (Thumbprint)'}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );

    return (
        <View style={styles.container}>
            <ImageBackground
                source={require('../../assets/images/madison_map_bg.png')}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
            />
            <LinearGradient
                colors={['rgba(249, 250, 251, 0.4)', 'rgba(249, 250, 251, 0.8)']}
                style={StyleSheet.absoluteFill}
            />
            <StatusBar barStyle="dark-content" />
            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.headerTitle}>FundMyMeal</Text>
                        <View style={styles.locationTag}>
                            <Ionicons name="location" size={12} color="#059669" />
                            <Text style={styles.locationText}>Madison, WI</Text>
                        </View>
                    </View>
                    <TouchableOpacity style={styles.identityBadge} onPress={() => setUserSwitcherVisible(true)}>
                        <View style={styles.userIcon}>
                            <Ionicons name={currentUserId ? "person" : "person-outline"} size={16} color="#059669" />
                        </View>
                        <View>
                            <Text style={styles.identitySubtitle}>
                                {currentUserId ? "LOGGED IN AS" : (activeMode === 'recipient' ? "ID REQUIRED" : "GUEST MODE")}
                            </Text>
                            <Text style={styles.identityName}>
                                {currentUserId ? currentUserName : (
                                    activeMode === 'donor' ? 'Guest Donor' :
                                        activeMode === 'partner' ? 'Community Partner' :
                                            'Anonymous'
                                )}
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Mode Switcher */}
                <View style={styles.switcherContainer}>
                    <View style={styles.switcherBg}>
                        {['recipient', 'donor', 'partner'].map(m => (
                            <TouchableOpacity
                                key={m}
                                style={[styles.switchBtn, activeMode === m && styles.switchBtnActive]}
                                onPress={() => setActiveMode(m)}
                            >
                                <Text style={[styles.switchText, activeMode === m && styles.switchTextActive]}>
                                    {m.toUpperCase()}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {activeMode === 'recipient' && (
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.secondaryAction} onPress={() => setRegModalVisible(true)}>
                            <Ionicons name="finger-print" size={16} color="#059669" />
                            <Text style={styles.secondaryActionText}>Register Identity</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {activeMode === 'partner' ? (
                    <ScrollView contentContainerStyle={{ padding: 20 }}>
                        <View style={styles.partnerCard}>
                            <View style={styles.formIconButton}>
                                <Ionicons name="storefront" size={28} color="#fff" />
                            </View>
                            <Text style={styles.formTitle}>Partner with Us</Text>
                            <Text style={styles.formSubtitle}>Empower your kitchen to serve the local community.</Text>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>ESTABLISHMENT NAME</Text>
                                <TextInput style={styles.input} placeholder="e.g. Blue Plate Diner"
                                    value={partnerForm.name} onChangeText={t => setPartnerForm({ ...partnerForm, name: t })} />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>DESCRIPTION / ADDRESS</Text>
                                <TextInput style={styles.input} placeholder="Location and specialty"
                                    value={partnerForm.description} onChangeText={t => setPartnerForm({ ...partnerForm, description: t })} />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>INITIAL POOL ($)</Text>
                                <TextInput style={styles.input} keyboardType="numeric" placeholder="0.00"
                                    value={partnerForm.initialFunds.toString()} onChangeText={t => setPartnerForm({ ...partnerForm, initialFunds: t })} />
                            </View>

                            <TouchableOpacity onPress={handleRegisterPartner} disabled={isRegisteringPartner}>
                                <View style={[styles.submitBtn, { backgroundColor: '#111827' }]}>
                                    {isRegisteringPartner ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Launch Partnership</Text>}
                                </View>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                ) : (
                    <FlatList
                        data={restaurants}
                        keyExtractor={item => item.id}
                        renderItem={renderRestaurant}
                        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                        ListEmptyComponent={<Text style={styles.emptyText}>Finding local kitchens...</Text>}
                        refreshing={loading}
                        onRefresh={fetchRestaurants}
                    />
                )}

                {/* Registration Modal */}
                <Modal animationType="fade" transparent visible={regModalVisible}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <TouchableOpacity style={styles.closeBtn} onPress={() => setRegModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#9ca3af" />
                            </TouchableOpacity>
                            <View style={styles.modalHeaderIcon}>
                                <Ionicons name="person-add" size={40} color="#059669" />
                            </View>
                            <Text style={styles.modalTitle}>Add New Profile</Text>
                            <Text style={styles.modalSubtitle}>Enter a name. You will then need to authorize this new profile using one of your phone's saved fingerprints.</Text>
                            <TextInput style={styles.modalInput} placeholder="Profile Name" value={newUserName} onChangeText={setNewUserName} />
                            <TouchableOpacity onPress={handleRegisterUser}>
                                <View style={[styles.modalBtn, { backgroundColor: '#059669' }]}>
                                    <Text style={styles.modalBtnText}>Verify & Create Profile</Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>

                {/* User Switcher Modal */}
                <Modal animationType="fade" transparent visible={userSwitcherVisible}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <TouchableOpacity style={styles.closeBtn} onPress={() => setUserSwitcherVisible(false)}>
                                <Ionicons name="close" size={24} color="#9ca3af" />
                            </TouchableOpacity>
                            <Text style={styles.modalTitle}>Switch Account</Text>
                            <View style={{ width: '100%', marginTop: 10 }}>
                                {allUsers.map(user => (
                                    <TouchableOpacity key={user.id} style={styles.switcherUserRow} onPress={() => handleSwitchUser(user)}>
                                        <View style={styles.userIconSmall}>
                                            <Ionicons name="person" size={14} color="#059669" />
                                        </View>
                                        <Text style={[styles.switcherUserName, currentUserId === user.id && { color: '#059669', fontWeight: '800' }]}>
                                            {user.name}
                                        </Text>
                                        {currentUserId === user.id && <Ionicons name="checkmark-circle" size={18} color="#059669" />}
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity style={[styles.switcherUserRow, { marginTop: 10, borderBottomWidth: 0 }]}
                                    onPress={() => { setUserSwitcherVisible(false); setRegModalVisible(true); }}>
                                    <View style={[styles.userIconSmall, { backgroundColor: '#f1f5f9' }]}>
                                        <Ionicons name="add" size={14} color="#64748b" />
                                    </View>
                                    <Text style={[styles.switcherUserName, { color: '#64748b' }]}>Add New Account</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Premium Donation Modal (Stripe Style) */}
                <Modal animationType="slide" transparent visible={donationModalVisible}>
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                        <View style={styles.stripeModal}>
                            <View style={styles.stripeHeader}>
                                <Text style={styles.stripeBrand}>FundMyMeal Pay</Text>
                                <TouchableOpacity onPress={() => setDonationModalVisible(false)}><Ionicons name="close" size={20} color="#6b7280" /></TouchableOpacity>
                            </View>

                            {paymentStep === 'details' && (
                                <View>
                                    <Text style={styles.stripeAmount}>Support {selectedRestaurant?.name}</Text>
                                    <View style={styles.amountSelector}>
                                        <Text style={styles.currencySymbol}>$</Text>
                                        <TextInput style={styles.amountInput} value={donationAmount} onChangeText={setDonationAmount} keyboardType="numeric" />
                                    </View>

                                    <View style={styles.cardInputContainer}>
                                        <View style={styles.cardRow}>
                                            <Ionicons name="card" size={20} color="#6b7280" style={{ marginRight: 10 }} />
                                            <TextInput style={styles.cardNumber} placeholder="Card number" value={cardDetails.number}
                                                onChangeText={t => setCardDetails({ ...cardDetails, number: t })} maxLength={16} />
                                        </View>
                                        <View style={styles.divider} />
                                        <View style={{ flexDirection: 'row' }}>
                                            <TextInput style={styles.cardSmall} placeholder="MM/YY" value={cardDetails.expiry}
                                                onChangeText={t => setCardDetails({ ...cardDetails, expiry: t })} maxLength={5} />
                                            <View style={[styles.divider, { width: 1, height: '100%' }]} />
                                            <TextInput style={styles.cardSmall} placeholder="CVC" value={cardDetails.cvc}
                                                onChangeText={t => setCardDetails({ ...cardDetails, cvc: t })} maxLength={3} />
                                        </View>
                                    </View>

                                    <TouchableOpacity onPress={handleDonationSubmit}>
                                        <View style={styles.stripeButton}>
                                            <Text style={styles.stripeButtonText}>Pay ${donationAmount}</Text>
                                        </View>
                                    </TouchableOpacity>
                                    <Text style={styles.secureText}><Ionicons name="lock-closed" size={10} /> Secure Stripe-encrypted payment</Text>
                                </View>
                            )}

                            {paymentStep === 'processing' && (
                                <View style={styles.processingContainer}>
                                    <ActivityIndicator size="large" color="#6366f1" />
                                    <Text style={styles.processingText}>Processing with Stripe...</Text>
                                </View>
                            )}

                            {paymentStep === 'success' && (
                                <View style={styles.processingContainer}>
                                    <Ionicons name="checkmark-circle" size={60} color="#059669" />
                                    <Text style={styles.successText}>Payment Successful!</Text>
                                </View>
                            )}
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9fafb' },
    header: { paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(243, 244, 246, 0.4)' },
    headerTitle: { fontSize: 26, fontWeight: '900', color: '#111827', letterSpacing: -1.5 },
    locationTag: { flexDirection: 'row', alignItems: 'center', marginTop: -2 },
    locationText: { fontSize: 10, fontWeight: '800', color: '#059669', marginLeft: 4 },
    identityBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.8)', padding: 8, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(243, 244, 246, 0.6)', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
    userIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(5, 150, 105, 0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    identitySubtitle: { fontSize: 8, fontWeight: '900', color: '#9ca3af' },
    identityName: { fontSize: 13, fontWeight: '700', color: '#374151' },

    switcherContainer: { padding: 16 },
    switcherBg: { flexDirection: 'row', backgroundColor: 'rgba(241, 245, 249, 0.8)', padding: 4, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)' },
    switchBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 14 },
    switchBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
    switchText: { fontSize: 11, fontWeight: '800', color: '#94a3b8' },
    switchTextActive: { color: '#059669' },

    actionRow: { paddingHorizontal: 16, marginBottom: 10 },
    secondaryAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderBottomWidth: 1.5, borderBottomColor: '#059669', paddingBottom: 2 },
    secondaryActionText: { color: '#059669', fontSize: 13, fontWeight: '700', marginLeft: 6 },

    card: { backgroundColor: 'rgba(255, 255, 255, 0.92)', borderRadius: 32, padding: 24, marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 20, elevation: 8, marginHorizontal: 2, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.6)' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    restaurantName: { fontSize: 22, fontWeight: '800', color: '#111827', flex: 1, letterSpacing: -0.5 },
    badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
    badgeText: { fontSize: 10, fontWeight: '900' },
    statsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(249, 250, 251, 0.5)', borderRadius: 20, padding: 18, marginBottom: 24 },
    statItem: { flex: 1, alignItems: 'center' },
    statLabel: { fontSize: 10, fontWeight: '900', color: '#94a3b8', marginBottom: 6, letterSpacing: 0.5 },
    statValue: { fontSize: 24, fontWeight: '900', color: '#1e293b' },
    divider: { width: 1, backgroundColor: 'rgba(226, 232, 240, 0.6)' },
    actionButton: { height: 60, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    actionButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    disabledButton: { backgroundColor: '#f1f5f9' },

    partnerCard: { backgroundColor: '#fff', borderRadius: 24, padding: 25, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, elevation: 8 },
    formIconButton: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    formTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8 },
    formSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 30 },
    inputGroup: { marginBottom: 20 },
    label: { fontSize: 11, fontWeight: '900', color: '#94a3b8', marginBottom: 8 },
    input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 15, fontSize: 16, color: '#1e293b' },
    submitBtn: { height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
    submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', padding: 25 },
    modalContent: { backgroundColor: '#fff', borderRadius: 30, padding: 30, alignItems: 'center' },
    closeBtn: { position: 'absolute', top: 20, right: 20 },
    modalHeaderIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(5, 150, 105, 0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 10 },
    modalSubtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 20 },
    modalInput: { width: '100%', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 15, padding: 18, fontSize: 16, marginBottom: 20 },
    modalBtn: { paddingHorizontal: 40, paddingVertical: 18, borderRadius: 100 },
    modalBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

    stripeModal: { backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 25, paddingBottom: 40, marginTop: 'auto' },
    stripeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    stripeBrand: { fontSize: 18, fontWeight: '800', color: '#6366f1' },
    stripeAmount: { fontSize: 22, fontWeight: '800', color: '#1f2937', marginBottom: 10 },
    amountSelector: { flexDirection: 'row', alignItems: 'center', marginBottom: 25 },
    currencySymbol: { fontSize: 32, color: '#9ca3af', marginRight: 10 },
    amountInput: { fontSize: 40, fontWeight: '900', color: '#111827' },
    cardInputContainer: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, marginBottom: 30 },
    cardRow: { flexDirection: 'row', alignItems: 'center', padding: 15 },
    cardNumber: { flex: 1, fontSize: 16 },
    cardSmall: { flex: 1, padding: 15, fontSize: 16, textAlign: 'center' },
    stripeButton: { backgroundColor: '#111827', height: 60, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
    stripeButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
    secureText: { textAlign: 'center', fontSize: 11, color: '#9ca3af' },
    processingContainer: { height: 300, alignItems: 'center', justifyContent: 'center' },
    processingText: { marginTop: 15, fontSize: 16, color: '#6b7280', fontWeight: '600' },
    successText: { marginTop: 15, fontSize: 20, color: '#111827', fontWeight: '800' },
    emptyText: { textAlign: 'center', marginTop: 100, color: '#94a3b8', fontSize: 16, fontWeight: '600' },
    switcherUserRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    userIconSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(5, 150, 105, 0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    switcherUserName: { flex: 1, fontSize: 16, color: '#1e293b', fontWeight: '500' },
});
