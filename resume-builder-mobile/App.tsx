import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import DashboardScreen from './screens/DashboardScreen';
import TemplateSelectionScreen from './screens/TemplateSelectionScreen';

type Route =
  | { screen: 'dashboard' }
  | { screen: 'templateSelection'; templateId: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ screen: 'dashboard' });
  const [selectedTemplateId, setSelectedTemplateId] = useState('classic');

  if (route.screen === 'templateSelection') {
    return (
      <SafeAreaView style={styles.root}>
        <TemplateSelectionScreen
          initialTemplateId={route.templateId}
          onGoBack={() => setRoute({ screen: 'dashboard' })}
          onApplyTemplate={(id) => {
            setSelectedTemplateId(id);
            setRoute({ screen: 'dashboard' });
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <DashboardScreen
        selectedTemplateId={selectedTemplateId}
        onNavigateToTemplate={(id) =>
          setRoute({ screen: 'templateSelection', templateId: id })
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f2f5f8',
  },
});
