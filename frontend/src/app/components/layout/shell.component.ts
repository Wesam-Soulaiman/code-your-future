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
import { ADMIN_SIGN_IN, STUDENT_SIGN_IN } from '../../guards/home-route';
import { BrandMarkComponent } from '../shared/brand-mark.component';

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
    BrandMarkComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onResize()',
    '(document:keydown.escape)': 'onEscape()',
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
    // Built from the display name only: the safe DTO carries no email address,
    // and no username — a Student's is internal and never leaves the server.
    const parts = this.sessionService
      .userDisplayName()
      .split(/\s+/)
      .filter((part) => part.length > 0);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
    return initials.toUpperCase() || 'U';
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

  /**
   * Every navigation item in the product, for both workspaces.
   *
   * ── One list, one shell ⟨CP4 closeout⟩ ────────────────────────────────────
   * The Student area used to carry its own header with its own navigation. Two
   * navigation implementations meant two sets of active-state rules, two
   * responsive behaviours, and two places to forget something. There is now one
   * shell, and `roles` decides what each person sees inside it.
   *
   * **Every item carries an explicit `roles`.** That is what makes the filter
   * below deny by default: a session holding an unrecognised or legacy role
   * matches nothing and gets no navigation at all, rather than inheriting
   * whatever happened to be left unrestricted.
   *
   * The template's /users management screen was retired in Checkpoint 1.
   * Resources, Live Slides, Tasks, Pinned Students, and Talent Reels arrive
   * with later checkpoints; nothing is stubbed here. Every item below leads to
   * a page that works today.
   */
  private allNavItems: NavItem[] = [
    // ── Admin ──────────────────────────────────────────────────────────────
    {
      id: 'dashboard',
      labelKey: 'nav.dashboard',
      icon: 'fa-solid fa-gauge',
      route: '/dashboard',
      roles: [AppRole.ADMIN],
    },
    {
      // ⟨CP4⟩
      id: 'batches',
      labelKey: 'nav.batches',
      icon: 'fa-solid fa-layer-group',
      route: '/dashboard/batches',
      roles: [AppRole.ADMIN],
    },
    {
      // ⟨CP4⟩ A read-only directory, not user management: no create, edit,
      // delete, role change, or password reset exists behind it.
      id: 'students',
      labelKey: 'nav.students',
      icon: 'fa-solid fa-user-group',
      route: '/dashboard/students',
      roles: [AppRole.ADMIN],
    },
    {
      // Added because the feature now exists ⟨CP3A catalog⟩. Nothing is stubbed
      // here: every item in this list leads to a page that works.
      id: 'profile-catalogs',
      labelKey: 'nav.profileCatalogs',
      icon: 'fa-solid fa-list-ul',
      route: '/dashboard/profile-catalogs',
      roles: [AppRole.ADMIN],
    },

    // ── Student ────────────────────────────────────────────────────────────
    {
      id: 'student-home',
      labelKey: 'nav.home',
      icon: 'fa-solid fa-house',
      route: '/student/welcome',
      roles: [AppRole.STUDENT],
    },
    {
      // ⟨CP4⟩
      id: 'student-batches',
      labelKey: 'nav.myBatches',
      icon: 'fa-solid fa-layer-group',
      route: '/student/batches',
      roles: [AppRole.STUDENT],
    },
    {
      id: 'student-profile',
      labelKey: 'nav.editProfile',
      icon: 'fa-solid fa-user-pen',
      route: '/student/profile',
      roles: [AppRole.STUDENT],
    },
  ];

  /**
   * The items this session may see.
   *
   * Deny by default: an item with no `roles` would be visible to anybody, so
   * none has none. A session with an unrecognised role therefore gets an empty
   * sidebar rather than a partial one.
   *
   * **This is not authorization.** Hiding a link stops nobody from typing a
   * URL. Every route is independently guarded, and every request is
   * re-authorised server-side against live `_Role` membership.
   */
  navItems = computed(() => {
    const held = this.sessionService.roles();
    return this.allNavItems.filter(
      (item) =>
        Array.isArray(item.roles) &&
        item.roles.length > 0 &&
        item.roles.some((role) => held.includes(role as AppRole)),
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
    // Never leave the page unscrollable behind a drawer that no longer exists.
    this.lockBodyScroll(false);
  }

  onResize(): void {
    this.isMobile.set(window.innerWidth < 768);
    if (!this.isMobile()) {
      this.mobileMenuOpen.set(false);
      this.lockBodyScroll(false);
    }
  }

  /** Escape closes the mobile drawer, as it does every other overlay. */
  onEscape(): void {
    if (this.mobileMenuOpen()) this.closeMobileMenu();
  }

  /**
   * Stop the page behind the drawer scrolling under it.
   *
   * Always paired with closing, including on resize and on destroy — a page
   * left with `overflow: hidden` on the body is permanently unscrollable, and
   * the drawer that caused it is no longer on screen to explain why.
   */
  private lockBodyScroll(locked: boolean): void {
    document.body.style.overflow = locked ? 'hidden' : '';
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
      this.lockBodyScroll(this.mobileMenuOpen());
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  /**
   * Close the drawer.
   *
   * Called by the overlay, by Escape, and by **every navigation item** — a
   * drawer left open over the page it just navigated to hides the result of the
   * tap that closed it.
   */
  closeMobileMenu(): void {
    if (this.isMobile()) {
      this.mobileMenuOpen.set(false);
      this.lockBodyScroll(false);
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

  /**
   * Sign out, landing on the sign-in page that matches the session ⟨CP4 closeout⟩.
   *
   * A Student sent to `/auth` would be asked for a username and password they
   * will never have. The role is read **before** the session is cleared, since
   * clearing it empties the role list.
   */
  logout(): void {
    const target = this.sessionService.roles().includes(AppRole.STUDENT)
      ? STUDENT_SIGN_IN
      : ADMIN_SIGN_IN;

    this.authApi.logout().subscribe(() => {
      this.router.navigate([target]);
    });
  }

  goBack(): void {
    const route = this.pageTitleService.backRoute();
    if (route) {
      this.router.navigate([route]);
    }
  }
}
