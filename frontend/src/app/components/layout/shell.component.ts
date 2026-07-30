import { environment } from '../../../environments/environment';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MenuItem } from 'primeng/api';
import { Popover, PopoverModule } from 'primeng/popover';
import { SwitchThemeService } from '../../services/switch-theme.service';
import { ChangeLangService } from '../../services/change-lang.service';
import { PageTitleService } from '../../services/page-title.service';
import { AuthApiService } from '../../services/dataService/user-service';
import { SessionService } from '../../services/session.service';
import { DividerModule } from 'primeng/divider';
import { SearchInputComponent } from '../shared/data-table/search-input.component';
import { AppRole } from '../../config/user-roles';

interface NavItem {
  id: string;
  labelKey: string;
  icon: string;
  route?: string;
  roles?: AppRole[];
  children?: NavItem[];
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterModule,
    TranslateModule,
    ButtonModule,
    TooltipModule,
    AvatarModule,
    MenuModule,
    DividerModule,
    ConfirmDialogModule,
    SearchInputComponent,
    DividerModule,
    PopoverModule,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onResize()',
  },
})
export class ShellComponent implements OnInit, OnDestroy {
  private themeService = inject(SwitchThemeService);
  private authApi = inject(AuthApiService);
  protected sessionService = inject(SessionService);
  private router = inject(Router);
  protected langService = inject(ChangeLangService);
  protected pageTitleService = inject(PageTitleService);
  sidebarCollapsed = signal(false);
  mobileMenuOpen = signal(false);
  isMobile = signal(window.innerWidth < 768);
  isDarkMode = signal(true);

  appVersion = environment.appVersion;
  navbarHeight = signal('4rem'); // h-16 = 4rem

  sidebarWidth = computed(() => {
    if (this.isMobile()) return '16rem';
    return this.sidebarCollapsed() ? '5rem' : '16rem';
  });

  userInitials = computed(() => {
    const user = this.sessionService.user();
    const f = user?.firstName?.[0] ?? '';
    const l = user?.lastName?.[0] ?? '';
    // Falls back to the username: the safe DTO carries no email address.
    return (f + l).toUpperCase() || (user?.username?.[0] ?? 'U').toUpperCase();
  });
  themeIcon = computed(() => (this.isDarkMode() ? 'fa-solid fa-sun' : 'fa-solid fa-moon'));
  backIcon = computed(() =>
    this.langService.currentDirection() === 'rtl'
      ? 'fa-solid fa-arrow-right'
      : 'fa-solid fa-arrow-left',
  );
  collapseIcon = computed(() => {
    const isRtl = this.langService.currentDirection() === 'rtl';
    const isCollapsed = this.sidebarCollapsed();
    if (isRtl) {
      return isCollapsed ? 'fa-solid fa-angles-left' : 'fa-solid fa-angles-right';
    }
    return isCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
  });

  getSubmenuIcon(id: string): string {
    return this.isMenuExpanded(id) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
  }

  // Track expanded menu items
  expandedMenus = signal<Set<string>>(new Set());

  // Collapsed sidebar: popover for parent items with children
  private collapsedPopover = viewChild<Popover>('collapsedPopover');
  hoveredParent = signal<NavItem | null>(null);
  hoveredChildId = signal<string | null>(null);

  private popoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

  showCollapsedPopover(item: NavItem, event: Event): void {
    this.cancelPopoverClose();
    const popover = this.collapsedPopover();
    if (!popover || !item.children) return;
    this.hoveredParent.set(item);
    popover.toggle(event);
  }

  schedulePopoverClose(): void {
    this.popoverCloseTimer = setTimeout(() => {
      this.collapsedPopover()?.hide();
    }, 500);
  }

  cancelPopoverClose(): void {
    if (this.popoverCloseTimer) {
      clearTimeout(this.popoverCloseTimer);
      this.popoverCloseTimer = null;
    }
  }

  isRouteActive(route: string | undefined): boolean {
    if (!route) return false;
    return this.router.isActive(route, {
      paths: 'subset',
      queryParams: 'subset',
      fragment: 'ignored',
      matrixParams: 'ignored',
    });
  }

  // Track pinned items (stored by ID)
  pinnedItemIds = signal<Set<string>>(new Set());

  // Get all pinnable items (children only)
  private getAllChildren(): NavItem[] {
    const children: NavItem[] = [];
    for (const item of this.navItems()) {
      if (item.children) {
        children.push(...item.children);
      }
    }
    return children;
  }

  // Computed: Get pinned items as NavItem objects
  pinnedItems = computed(() => {
    const pinnedIds = this.pinnedItemIds();
    const allChildren = this.getAllChildren();
    return allChildren.filter((child) => pinnedIds.has(child.id));
  });

  // Check if an item is pinned
  isPinned(id: string): boolean {
    return this.pinnedItemIds().has(id);
  }

  // Toggle pin state
  togglePin(item: NavItem, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    this.pinnedItemIds.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(item.id)) {
        newSet.delete(item.id);
      } else {
        newSet.add(item.id);
      }
      // Save to localStorage
      localStorage.setItem('pinnedNavItems', JSON.stringify([...newSet]));
      return newSet;
    });
  }

  // Load pinned items from localStorage
  private loadPinnedItems(): void {
    const stored = localStorage.getItem('pinnedNavItems');
    if (stored) {
      try {
        const ids = JSON.parse(stored) as string[];
        this.pinnedItemIds.set(new Set(ids));
      } catch {
        // Invalid data, ignore
      }
    }
  }

  // The template's /users management screen was retired in Checkpoint 1.
  // Batch navigation (Overview, Students, Resources, Live Slides, Tasks, Pinned
  // Students) arrives with the Batch checkpoints; nothing is stubbed here.
  private allNavItems: NavItem[] = [
    {
      id: 'dashboard',
      labelKey: 'nav.dashboard',
      icon: 'fa-solid fa-gauge',
      route: '/dashboard',
    },
  ];

  // Role-set aware: an item without `roles` is visible to any authenticated
  // user; otherwise the user must hold at least one listed role.
  navItems = computed(() => {
    const held = this.sessionService.roles();
    return this.allNavItems.filter(
      (item) => !item.roles || item.roles.some((role) => held.includes(role as AppRole)),
    );
  });

  userMenuItems: MenuItem[] = [
    { separator: true },
    { label: 'Logout', icon: 'fa-solid fa-right-from-bracket', command: () => this.logout() },
  ];

  ngOnInit(): void {
    // Global font size
    document.documentElement.style.fontSize = '14px';

    // Init theme
    const currentTheme = this.themeService.getCurrentTheme();
    this.isDarkMode.set(currentTheme === 'dark');
    this.themeService.initTheme();

    // Init language
    this.langService.initLang();

    // Load pinned items
    this.loadPinnedItems();
  }

  ngOnDestroy(): void {
    if (this.popoverCloseTimer) {
      clearTimeout(this.popoverCloseTimer);
      this.popoverCloseTimer = null;
    }
  }

  onResize(): void {
    this.isMobile.set(window.innerWidth < 768);
    if (!this.isMobile()) {
      this.mobileMenuOpen.set(false);
    }
  }

  toggleTheme(): void {
    const newTheme = this.isDarkMode() ? 'light' : 'dark';
    this.isDarkMode.set(newTheme === 'dark');
    this.themeService.switchTheme(newTheme);
  }

  toggleLang(): void {
    const newLang = this.langService.currentLang() === 'en' ? 'ar' : 'en';
    this.langService.changeLang(newLang);
  }

  toggleSidebar(): void {
    if (this.isMobile()) {
      this.mobileMenuOpen.update((v) => !v);
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  closeMobileMenu(): void {
    if (this.isMobile()) {
      this.mobileMenuOpen.set(false);
    }
  }

  toggleMenu(id: string): void {
    this.expandedMenus.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  isMenuExpanded(id: string): boolean {
    return this.expandedMenus().has(id);
  }

  logout(): void {
    this.authApi.logout().subscribe(() => {
      this.router.navigate(['/auth']);
    });
  }

  goBack(): void {
    const route = this.pageTitleService.backRoute();
    if (route) {
      this.router.navigate([route]);
    }
  }
}
