import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type TemplateCardItem = {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  isSelected?: boolean;
  isRecommended?: boolean;
  recommendedReason?: string;
};

type TemplateCardProps = {
  template: TemplateCardItem;
  onPreview: (id: string) => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
};

export default function TemplateCard({ template, onPreview, onSelect, disabled }: TemplateCardProps) {
  const borderColor = template.isSelected ? '#2f5f8f' : '#d9e3ec';

  return (
    <View style={[styles.card, { borderColor }]}>
      <TouchableOpacity
        style={styles.previewArea}
        onPress={() => !disabled && onPreview(template.id)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Preview ${template.name}`}
      >
        <Text style={styles.previewLabel}>{template.name}</Text>
        <Text style={styles.previewHint}>Tap to preview</Text>
      </TouchableOpacity>

      <View style={styles.meta}>
        <Text style={styles.name}>{template.name}</Text>
        <Text style={styles.description}>{template.description}</Text>
        <Text style={styles.tags}>{template.tags.join(' | ')}</Text>
        {template.isRecommended && (
          <Text style={styles.recommended}>
            Recommended{template.recommendedReason ? `: ${template.recommendedReason}` : ''}
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => onPreview(template.id)}
          disabled={disabled}
        >
          <Text style={styles.btnSecondaryText}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => onSelect(template.id)}
          disabled={disabled}
        >
          <Text style={styles.btnPrimaryText}>Use Template</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.badges}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{template.isSelected ? 'Applied' : 'Available'}</Text>
        </View>
        {template.isRecommended && (
          <View style={[styles.pill, styles.pillRecommended]}>
            <Text style={[styles.pillText, styles.pillRecommendedText]}>Recommended</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 16,
  },
  previewArea: {
    aspectRatio: 794 / 1123,
    backgroundColor: '#f7f9ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#efe4d9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  previewLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2f5f8f',
  },
  previewHint: {
    fontSize: 12,
    color: '#5a6778',
    marginTop: 4,
  },
  meta: {
    marginBottom: 10,
  },
  name: {
    fontWeight: '700',
    fontSize: 15,
    color: '#172332',
  },
  description: {
    fontSize: 13,
    color: '#5a6778',
    marginTop: 4,
  },
  tags: {
    fontSize: 12,
    color: '#6b778e',
    marginTop: 4,
  },
  recommended: {
    fontSize: 12,
    color: '#2c3a56',
    fontWeight: '500',
    marginTop: 5,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#2f5f8f',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: '#eef3f8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d2deea',
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#213750',
    fontWeight: '600',
    fontSize: 14,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#e8eff6',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2f4e6f',
  },
  pillRecommended: {
    backgroundColor: '#eaf5ff',
    borderWidth: 1,
    borderColor: '#8eb5d5',
  },
  pillRecommendedText: {
    color: '#0c3b63',
  },
});
