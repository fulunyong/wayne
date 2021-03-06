import { OnInit, ChangeDetectorRef, Component, OnDestroy, AfterContentInit, ViewChild, ElementRef } from '@angular/core';
import { MessageHandlerService } from '../../shared/message-handler/message-handler.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CreateEditIngressComponent } from './create-edit-ingress/create-edit-ingress.component';
import { Observable } from 'rxjs/Observable';
import { State } from '@clr/angular';
import { App } from '../../shared/model/v1/app';
import { Cluster } from '../../shared/model/v1/cluster';
import { Ingress } from '../../shared/model/v1/ingress';
import { IngressService } from '../../shared/client/v1/ingress.service';
import { AppService } from '../../shared/client/v1/app.service';
import { ClusterService } from '../../shared/client/v1/cluster.service';
import { CacheService } from '../../shared/auth/cache.service';
import { PublishHistoryService } from '../common/publish-history/publish-history.service';
import {
  ConfirmationButtons,
  ConfirmationState,
  ConfirmationTargets, httpStatusCode,
  PublishType, TemplateState,
} from '../../shared/shared.const';
import { AuthService } from '../../shared/auth/auth.service';
import { PublishService } from '../../shared/client/v1/publish.service';
import { PublishStatus } from '../../shared/model/v1/publish-status';
import { ConfirmationMessage } from '../../shared/confirmation-dialog/confirmation-message';
import { ConfirmationDialogService } from '../../shared/confirmation-dialog/confirmation-dialog.service';
import { Subscription} from 'rxjs/Subscription';
import { PageState } from '../../shared/page/page-state';
import { TabDragService } from '../../shared/client/v1/tab-drag.service';
import { OrderItem } from '../../shared/model/v1/order';
import { ListIngressComponent } from './list-ingress/list-ingress.component';
import { IngressTplService } from '../../shared/client/v1/ingresstpl.service';
import { IngressTpl } from '../../shared/model/v1/ingresstpl';
import { IngressStatus, KubeIngress } from '../../shared/model/v1/kubernetes/ingress';
import { IngressClient } from '../../shared/client/v1/kubernetes/ingress';

const showState = {
  '创建时间': {hidden: false},
  '上线机房': {hidden: false},
  '发布说明': {hidden: false},
  '创建者': {hidden: false},
  '操作': {hidden: false}
};

@Component({
  selector: 'wayne-ingress',
  templateUrl: './ingress.component.html',
  styleUrls: ['./ingress.component.scss']
})
export class IngressComponent implements OnInit, OnDestroy, AfterContentInit {
  @ViewChild(CreateEditIngressComponent)
  createEditIngress: CreateEditIngressComponent;
  @ViewChild(ListIngressComponent)
  listIngressComponent: ListIngressComponent;

  pageState: PageState = new PageState();

  isOnline: boolean = false;
  ingressId: number;
  app: App;
  appId: number;
  clusters: Cluster[];
  ingresses: Ingress[];
  changedIngressTpls: IngressTpl[];
  private timer: any = null;
  publishStatus: PublishStatus[];
  subscription: Subscription;
  showList: any[] = new Array();
  showState: object = showState;
  tabScription: Subscription;
  orderCache: Array<OrderItem>;

  constructor(private ingressService: IngressService,
              private ingressTplService: IngressTplService,
              private ingressClient: IngressClient,
              private publishHistoryService: PublishHistoryService,
              private route: ActivatedRoute,
              private router: Router,
              private publishService: PublishService,
              public cacheService: CacheService,
              public authService: AuthService,
              private cdr: ChangeDetectorRef,
              private appService: AppService,
              private deletionDialogService: ConfirmationDialogService,
              private clusterService: ClusterService,
              private tabDragService: TabDragService,
              private el: ElementRef,
              private messageHandlerService: MessageHandlerService) {
    this.tabScription = this.tabDragService.tabDragOverObservable.subscribe(over => {
      if (over) {
        this.tabChange();
      }
    })
    this.subscription = deletionDialogService.confirmationConfirm$.subscribe(message => {
      if (message &&
        message.state === ConfirmationState.CONFIRMED &&
        message.source === ConfirmationTargets.INGRESS) {
        const ingressId = message.data;
        this.ingressService.deleteById(ingressId, this.appId)
          .subscribe(
            response => {
              this.messageHandlerService.showSuccess('ingress 删除成功！');
              this.ingressId = null;
              this.initIngress(true);
            },
            error => {
              this.messageHandlerService.handleError(error);
            }
          );
      }
    });
  }

  ngOnInit() {
    this.initShow();
  }

  initShow() {
    this.showList = [];
    Object.keys(this.showState).forEach(key => {
      if (!this.showState[key].hidden) {
        this.showList.push(key);
      }
    });
  }

  confirmEvent() {
    Object.keys(this.showState).forEach(key => {
      if (this.showList.indexOf(key) > -1) {
        this.showState[key] = {hidden: false};
      } else {
        this.showState[key] = {hidden: true};
      }
    });
  }

  cancelEvent() {
    this.initShow();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    this.subscription.unsubscribe();
    this.tabScription.unsubscribe();
  }

  onlineChange() {
    this.retrieve();
  }

  tabChange() {
    const orderList = [].slice.call(this.el.nativeElement.querySelectorAll('.tabs-item')).map((item, index) => {
      return {
        id: parseInt(item.id),
        order: index
      };
    });
    if (this.orderCache && JSON.stringify(this.orderCache) === JSON.stringify(orderList)) {
      return;
    }
    this.ingressService.updateOrder(this.appId, orderList).subscribe(
      response => {
        if (response.data === 'ok!') {
          this.initOrder();
          this.messageHandlerService.showSuccess('排序成功');
        }
      },
      error => {
        this.messageHandlerService.handleError(error);
      }
    );
  }

  tabClick(id: number) {
    if (id) {
      this.ingressId = id;
      this.navigateUri();
      this.retrieve();
    }
  }

  ngAfterContentInit() {
    this.initIngress();
  }

  initIngress(refreshTpl?: boolean) {
    this.appId = parseInt(this.route.parent.snapshot.params['id'], 10);
    const namespaceId = this.cacheService.namespaceId;
    this.ingressId = parseInt(this.route.snapshot.params['ingressId'], 10);
    Observable.combineLatest(
      this.clusterService.getNames(),
      this.ingressService.list(PageState.fromState({sort: {by: 'id', reverse: false}}, {pageSize: 1000}), 'false', this.appId + ''),
      this.appService.getById(this.appId, namespaceId)
    ).subscribe(
      response => {
        this.clusters = response[0].data;
        this.ingresses = response[1].data.list.sort((a, b) => a.order - b.order);
        this.initOrder(this.ingresses);
        this.app = response[2].data;
        if (refreshTpl) {
          this.retrieve();
        }
        const isRedirectUri = this.redirectUri();
        if (isRedirectUri) {
          this.navigateUri();
        }
        this.cdr.detectChanges();
      },
      error => {
        this.messageHandlerService.handleError(error);
      }
    );
  }

  navigateUri() {
    this.router.navigate([`portal/namespace/${this.cacheService.namespaceId}/app/${this.app.id}/ingress/${this.ingressId}`]);
  }

  redirectUri(): boolean {
    if (this.ingresses && this.ingresses.length > 0) {
      if (!this.ingressId) {
        this.ingressId = this.ingresses[0].id;
        return true;
      }
      for (const ingress of this.ingresses) {
        if (this.ingressId === ingress.id) {
          return false;
        }
      }
      this.ingressId = this.ingresses[0].id;
      return true;
    } else {
      return false;
    }
  }

  initOrder(ingresss?: Ingress[]) {
    if (ingresss) {
      this.orderCache = ingresss.map(item => {
        return {
          id: item.id,
          order: item.order
        };
      });
    } else {
      this.orderCache = [].slice.call(this.el.nativeElement.querySelectorAll('.tabs-item')).map((item, index) => {
        return {
          id: parseInt(item.id, 10),
          order: index
        };
      });
    }
  }

  getIngressId(ingressId: number): number {
    if (this.ingresses && this.ingresses.length > 0) {
      if (!ingressId) {
        return this.ingresses[0].id;
      }
      for (const ingress of this.ingresses) {
        if (ingressId === ingress.id) {
          return ingressId;
        }
      }
      return this.ingresses[0].id;
    } else {
      return null;
    }
  }

  // 点击创建 ingress
  createIngress(): void {
    this.createEditIngress.newOrEditIngress(this.app, this.filterCluster());
  }

  // 点击编辑 ingress
  editIngress() {
    this.createEditIngress.newOrEditIngress(this.app, this.filterCluster(), this.ingressId);
  }

  filterCluster(): Cluster[] {
    return this.clusters.filter((clusterObj: Cluster) => {
      return this.cacheService.namespace.metaDataObj.clusterMeta &&
        this.cacheService.namespace.metaDataObj.clusterMeta[clusterObj.name];
    });
  }

  publishHistory() {
    this.publishHistoryService.openModal(PublishType.DEPLOYMENT, this.ingressId);
  }

  // 创建 ingress 成功
  create(id: number) {
    if (id) {
      this.ingressId = id;
      this.retrieveIngresss();
      this.navigateUri();
      this.retrieve();
    }
  }

  deleteIngress() {
    if (this.publishStatus && this.publishStatus.length > 0) {
      this.messageHandlerService.warning('已上线 ingress 无法删除，请先下线 ingress！')
    } else {
      const deletionMessage = new ConfirmationMessage(
        '删除 ingress 确认',
        '是否确认删除 ingress',
        this.ingressId,
        ConfirmationTargets.INGRESS,
        ConfirmationButtons.DELETE_CANCEL
      );
      this.deletionDialogService.openComfirmDialog(deletionMessage);
    }
  }

  retrieve(state?: State): void {
    if (!this.ingressId) {
      return;
    }
    if (state) {
      this.pageState = PageState.fromState(state, {
        totalPage: this.pageState.page.totalPage,
        totalCount: this.pageState.page.totalCount
      });
    }
    this.pageState.params['deleted'] = false;
    this.pageState.params['isOnline'] = this.isOnline;

    if (!this.ingressId) {
      return;
    }
    if (state) {
      this.pageState = PageState.fromState(state, {
        totalPage: this.pageState.page.totalPage,
        totalCount: this.pageState.page.totalCount
      });
    }
    this.pageState.params['deleted'] = false;
    this.pageState.params['isOnline'] = this.isOnline;
    Observable.combineLatest(
      this.ingressTplService.listPage(this.pageState, this.appId, this.ingressId.toString()),
      this.publishService.listStatus(PublishType.INGRESS, this.ingressId)
    ).subscribe(
      response => {
        this.publishStatus = response[1].data;
        const tpls = response[0].data;
        this.pageState.page.totalPage = tpls.totalPage;
        this.pageState.page.totalCount = tpls.totalCount;
        this.changedIngressTpls = this.buildTplList(tpls.list, response[1].data);
        this.syncStatus();
      },
      error => this.messageHandlerService.handleError(error)
    );
  }

  buildTplList(ingressTpls: IngressTpl[], status: PublishStatus[]): IngressTpl[] {
    const tplStatusMap = {};
    if (status && status.length > 0) {
      for (const state of status) {
        if (!tplStatusMap[state.templateId]) {
          tplStatusMap[state.templateId] = Array<PublishStatus>();
        }
        state.errNum = 0;
        tplStatusMap[state.templateId].push(state);
      }
    }
    if (ingressTpls && ingressTpls.length > 0) {
      for (let i = 0; i < ingressTpls.length; i++) {
        const ing: KubeIngress = JSON.parse(ingressTpls[i].template);
        if (ing.spec.rules && ing.spec.rules.length > 0) {
          const publishStatus = tplStatusMap[ingressTpls[i].id];
          if (publishStatus && publishStatus.length > 0) {
            ingressTpls[i].status = publishStatus;
          }
        }
      }
    }
    return ingressTpls
  }

  syncStatus(): void {
    if (this.changedIngressTpls && this.changedIngressTpls.length > 0) {
      for (let i = 0; i < this.changedIngressTpls.length; i++) {
        const tpl = this.changedIngressTpls[i];
        if (tpl.status && tpl.status.length > 0) {
          for (let j = 0; j < tpl.status.length; j++) {
            const status = tpl.status[j];
            if (status.errNum > 2) {
              continue;
            }
            this.ingressClient.get(this.appId, status.cluster, this.cacheService.kubeNamespace, tpl.name).subscribe(
              response => {
                const code = response.statusCode || response.status;
                if (code === httpStatusCode.NoContent) {
                  this.changedIngressTpls[i].status[j].state = TemplateState.NOT_FOUND;
                  return;
                }
                if (response.data &&
                  this.changedIngressTpls &&
                  this.changedIngressTpls[i] &&
                  this.changedIngressTpls[i].status &&
                  this.changedIngressTpls[i].status[j]) {
                  this.changedIngressTpls[i].status[j].state = TemplateState.SUCCESS;
                } else {
                  this.changedIngressTpls[i].status[j].state = TemplateState.FAILD;
                }
              },
              error => {
                if (this.changedIngressTpls &&
                  this.changedIngressTpls[i] &&
                  this.changedIngressTpls[i].status &&
                  this.changedIngressTpls[i].status[j]) {
                  this.changedIngressTpls[i].status[j].errNum += 1;
                  this.messageHandlerService.showError(`${status.cluster}请求错误次数 ${this.changedIngressTpls[i].status[j].errNum} 次`);
                  if (this.changedIngressTpls[i].status[j].errNum === 3) {
                    this.messageHandlerService.showError(`${status.cluster}的错误请求已经停止，请联系管理员解决`);
                  }
                }
              }
            );
          }
        }
      }
    }
  }

  retrieveIngresss() {
    this.ingressService.list(PageState.fromState({sort: {by: 'id', reverse: false}}, {pageSize: 1000}), 'false', this.appId + '').subscribe(
      response => {
        this.ingresses = response.data.list.sort((a, b) => a.order - b.order);
        this.initOrder(this.ingresses);
      },
      error => {
        this.messageHandlerService.handleError(error);
      }
    );
  }

  createIngressTpl() {
    this.router.navigate([`portal/namespace/${this.cacheService.namespaceId}/app/${this.app.id}/ingress/${this.ingressId}/tpl`]);
  }

  cloneIngressTpl(tpl: IngressTpl) {
    if (tpl) {
      this.router.navigate([`portal/namespace/${this.cacheService.namespaceId}/app/${this.app.id}/ingress/${this.ingressId}/tpl/${tpl.id}`]);
    }

  }


}
