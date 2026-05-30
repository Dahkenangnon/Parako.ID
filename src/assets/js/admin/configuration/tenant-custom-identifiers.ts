import { setupCustomIdentifierFields } from './custom-identifiers.js';

const renderCard = (slot: number, idx: number): string => `
  <div class="flex items-center justify-between mb-3">
    <h3 class="text-sm font-semibold text-foreground">Slot ${slot} — New Field</h3>
    <button type="button" class="ci-remove-btn text-destructive hover:text-destructive/80 text-xs" data-ci-index="${idx}"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
  </div>
  <input type="hidden" name="authentication[custom_identifiers][fields][${idx}][slot]" value="${slot}">
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
    <div><label class="block text-xs font-medium text-foreground mb-1">Key (internal)</label><input type="text" name="authentication[custom_identifiers][fields][${idx}][key]" placeholder="employee_id" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono"></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Display Name</label><input type="text" name="authentication[custom_identifiers][fields][${idx}][name]" placeholder="Employee ID" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Placeholder / Hint</label><input type="text" name="authentication[custom_identifiers][fields][${idx}][hint_for_user]" placeholder="Enter your employee ID" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
    <div><label class="block text-xs font-medium text-foreground mb-1">Validation Type</label><select name="authentication[custom_identifiers][fields][${idx}][validation_type]" class="ci-validation-type w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"><option value="none" selected>None (length only)</option><option value="regex">Regex Pattern</option><option value="charset_mask">Charset + Mask</option></select></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Regex Pattern</label><input type="text" name="authentication[custom_identifiers][fields][${idx}][pattern]" placeholder="^[A-Z]{2}\\d{6}$" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono"></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Charset</label><select name="authentication[custom_identifiers][fields][${idx}][charset]" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"><option value="" selected>— Select —</option><option value="digits">Digits (0-9)</option><option value="alphanumeric">Alphanumeric</option><option value="uppercase_alphanumeric">Uppercase Alphanumeric</option><option value="hex">Hex (0-9, A-F)</option><option value="base20">Base20</option></select></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Mask</label><input type="text" name="authentication[custom_identifiers][fields][${idx}][mask]" placeholder="***-*-***" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono"><p class="mt-0.5 text-xs text-muted-foreground">* = charset char, others literal</p></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
    <div><label class="block text-xs font-medium text-foreground mb-1">Min Length</label><input type="number" name="authentication[custom_identifiers][fields][${idx}][min_length]" min="1" max="100" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Max Length</label><input type="number" name="authentication[custom_identifiers][fields][${idx}][max_length]" min="1" max="100" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></div>
    <div><label class="block text-xs font-medium text-foreground mb-1">Edit Policy</label><select name="authentication[custom_identifiers][fields][${idx}][edit_policy]" class="w-full px-2 py-1.5 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"><option value="set_once" selected>Set Once</option><option value="admin_only">Admin Only</option><option value="editable">Editable</option><option value="full">Full (edit + delete)</option></select></div>
    <div class="flex flex-col justify-end gap-1.5 pt-1">
      <label class="flex items-center space-x-2 text-xs"><input type="hidden" name="authentication[custom_identifiers][fields][${idx}][case_sensitive]" value=""><input type="checkbox" name="authentication[custom_identifiers][fields][${idx}][case_sensitive]" class="h-3.5 w-3.5 text-primary border-border focus:ring-primary"><span class="text-foreground">Case Sensitive</span></label>
      <label class="flex items-center space-x-2 text-xs"><input type="hidden" name="authentication[custom_identifiers][fields][${idx}][required_for_registration]" value=""><input type="checkbox" name="authentication[custom_identifiers][fields][${idx}][required_for_registration]" class="h-3.5 w-3.5 text-primary border-border focus:ring-primary"><span class="text-foreground">Required for Registration</span></label>
      <label class="flex items-center space-x-2 text-xs"><input type="hidden" name="authentication[custom_identifiers][fields][${idx}][usable_for_login]" value=""><input type="checkbox" name="authentication[custom_identifiers][fields][${idx}][usable_for_login]" class="h-3.5 w-3.5 text-primary border-border focus:ring-primary"><span class="text-foreground">Usable for Login</span></label>
    </div>
  </div>
`;

setupCustomIdentifierFields({
  containerId: 'tenant-ci-fields-container',
  addBtnId: 'tenant-ci-add-btn',
  renderCardHtml: renderCard,
  addBtnLabel: count =>
    `<i data-lucide="plus" class="h-4 w-4"></i> Add Custom Identifier (${count}/3)`,
});
