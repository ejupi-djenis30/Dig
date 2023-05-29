import 'package:flutter/material.dart';
import 'package:protocol_controller/gopher_controller.dart';
import 'package:protocol_parser/gopher_parser.dart';

// ignore: must_be_immutable
class HomeWidget extends StatefulWidget {
  List<TabData> tabs;
  List<String> preferedTabs;
  bool showAppBar = false;
  late TabController tabController;
  final VoidCallback onTabCountChanged;
  final VoidCallback changePreferedState;
  final VoidCallback changePreferedStateOn;
  final void Function(String) searchFunction;

  HomeWidget(
      {Key? key,
      required this.onTabCountChanged,
      required this.tabs,
      required this.searchFunction,
      required this.preferedTabs,
      required this.changePreferedState,
      required this.changePreferedStateOn})
      : super(key: key);

  @override
  _HomeWidgetState createState() => _HomeWidgetState();
}

class _HomeWidgetState extends State<HomeWidget> with TickerProviderStateMixin {
  @override
  void initState() {
    super.initState();
    widget.tabController =
        TabController(length: widget.tabs.length, vsync: this);
    widget.tabController.addListener(() {
      if (widget.preferedTabs
          .contains(widget.tabs[widget.tabController.index].title)) {
        widget.changePreferedStateOn.call();
      } else {
        widget.changePreferedState.call();
      }
    });
  }

  @override
  void dispose() {
    widget.tabController.dispose();
    super.dispose();
  }

  void updateAppBarVisibility() {
    setState(() {
      widget.showAppBar = widget.tabs.isNotEmpty;
    });
    widget.onTabCountChanged.call();
  }

  void _addTab() {
    setState(() {
      widget.tabs.add(
        TabData(icon: Icons.tab, title: 'New Tab', children: []),
      );
      int currentIndex = widget.tabController.index;
      widget.tabController.dispose();
      widget.tabController = TabController(
          length: widget.tabs.length, vsync: this, initialIndex: currentIndex);
    });
    updateAppBarVisibility();
  }

  void _removeTab(int index) {
    setState(() {
      widget.tabs.removeAt(index);
      int currentIndex = widget.tabController.index;
      widget.tabController.dispose();
      widget.tabController =
          TabController(length: widget.tabs.length, vsync: this);
    });
    updateAppBarVisibility();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: TabBar(
                controller: widget.tabController,
                unselectedLabelColor: Color(0xFFB9B9B9),
                labelColor: Color(0xFF2E2E2E),
                indicatorColor: Color(0xFF2E2E2E),
                isScrollable: true,
                tabs: [
                  ...widget.tabs.map((TabData tab) {
                    return Tab(
                      child: Row(
                        children: [
                          Icon(tab.icon),
                          SizedBox(width: 4),
                          Text(tab.title),
                          SizedBox(width: 4),
                          IconButton(
                            icon: Icon(Icons.close),
                            onPressed: () =>
                                _removeTab(widget.tabs.indexOf(tab)),
                            padding: EdgeInsets.zero,
                            constraints: BoxConstraints(),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
            IconButton(
              icon: Icon(Icons.add),
              onPressed: _addTab,
            ),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: widget.tabController,
            children: [
              ...widget.tabs
                  .map((TabData tab) => tab.createTab(widget.searchFunction)),
            ],
          ),
        ),
      ],
    );
  }
}

class TabData {
  IconData icon;
  String title;
  List<GopherElement> children;

  TabData({required this.icon, required this.title, required this.children});

  Widget createTab(void Function(String) search) {
    return ListView.builder(
      itemCount: children.length,
      itemBuilder: (context, index) {
        final gopherElement = children[index];
        late final IconData? icon;
        Uri elementUri = Uri(
            scheme: "gopher",
            host: gopherElement.host,
            port: gopherElement.port,
            path: gopherElement.path);
        Null Function()? onTap = () {
          search(elementUri.toString());
        };
        SearchWidget? subtitle = null;
        switch (gopherElement.element_type) {
          case GopherController.BINARY_SELECTOR:
            icon = Icons.file_copy_outlined;
            break;
          case GopherController.ERROR_SELECTOR:
            onTap = null;
            icon = null;
            break;
          case GopherController.FILE_SELECTOR:
            icon = Icons.file_copy;
            break;
          case GopherController.GIF_SELECTOR:
            icon = Icons.gif;
            break;
          case GopherController.IMAGE_SELECTOR:
            icon = Icons.image;
            break;
          case GopherController.INFO_SELECTOR:
            icon = null;
            onTap = null;
            break;
          case GopherController.INTERNET_SELECTOR:
            icon = Icons.public;
            break;
          case GopherController.MENU_SELECTOR:
            icon = Icons.menu;
            break;
          case GopherController.SEARCH_SELECTOR:
            icon = Icons.book;
            onTap = null;
            subtitle = SearchWidget(search: search, initUri: elementUri);
            break;
          default:
            icon = null;
            onTap = null;
            break;
        }
        return ListTile(
          leading: icon == null ? null : Icon(icon),
          title: Text(gopherElement.text),
          subtitle: subtitle,
          onTap: onTap,
        );
      },
    );
  }
}

class SearchWidget extends StatelessWidget {
  final TextEditingController searchController = TextEditingController();
  final void Function(String) search;
  final Uri initUri;

  SearchWidget({required this.search, required this.initUri});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: searchController,
            decoration: InputDecoration(
              hintText: 'Search',
            ),
          ),
        ),
        IconButton(
          icon: Icon(Icons.search),
          onPressed: () {
            search(Uri(
                    scheme: initUri.scheme,
                    path: initUri.path,
                    host: initUri.host,
                    port: initUri.port,
                    query: searchController.text)
                .toString());
          },
        ),
      ],
    );
  }
}
