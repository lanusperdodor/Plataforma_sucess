import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { colors } from '@/theme';

type Icon = ComponentProps<typeof Ionicons>['name'];
const icon = (on: Icon, off: Icon) =>
  function TabIcon({ color, focused, size }: { color: ComponentProps<typeof Ionicons>["color"]; focused: boolean; size: number }) {
    return <Ionicons name={focused ? on : off} size={size} color={color} />;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 66, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="aprender" options={{ title: 'Aprender', tabBarIcon: icon('book', 'book-outline') }} />
      <Tabs.Screen name="conversar" options={{ title: 'Conversar', tabBarIcon: icon('chatbubbles', 'chatbubbles-outline') }} />
      <Tabs.Screen name="revisar" options={{ title: 'Revisar', tabBarIcon: icon('refresh-circle', 'refresh-circle-outline') }} />
      <Tabs.Screen name="perfil" options={{ title: 'Perfil', tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
